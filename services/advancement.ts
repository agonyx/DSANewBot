import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
    actionModifications,
    apTransactions,
    liturgies,
    playerActionModifications,
    playerLiturgies,
    playerSpecialAbilities,
    playerSpells,
    playerTalents,
    spells,
    specialAbilities,
    stats,
    supernaturalProfiles,
    talents,
    weapons,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import { getCharacterSheet, getSelectedPlayer } from './characters';
import {
    ATTRIBUTE_KEYS,
    calculateAdvancementCost,
    calculateAttributeCost,
    calculateTalentCap,
    isAttributeKey,
} from '../utils/advancementUtils';
import { synchronizeEquipmentDerivedStatsInTransaction } from './equipment';
import type { Ctx } from './_ctx';

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ApSpendMetadata {
    category: string;
    referenceType?: string | null;
    referenceId?: string | null;
    description?: string | null;
}

export async function spendApInTransaction(
    tx: Transaction,
    ctx: Ctx,
    playerId: number,
    amount: number,
    metadata: ApSpendMetadata
) {
    if (!Number.isInteger(amount) || amount <= 0) throw httpError(400, 'AP amount must be a positive integer');
    const [row] = await tx.select().from(stats).where(eq(stats.player_id, playerId)).limit(1).for('update');
    if (!row) throw httpError(404, 'Character stats not found');
    if (row.ap_available < amount) {
        throw httpError(400, `Not enough AP (available: ${row.ap_available}, required: ${amount})`);
    }
    const balanceAfter = row.ap_available - amount;
    await tx
        .update(stats)
        .set({ ap_available: balanceAfter, ap_spent: row.ap_spent + amount })
        .where(eq(stats.id, row.id));
    const [ledger] = await tx
        .insert(apTransactions)
        .values({
            player_id: playerId,
            amount: -amount,
            balance_after: balanceAfter,
            category: metadata.category,
            reference_type: metadata.referenceType ?? null,
            reference_id: metadata.referenceId ?? null,
            description: metadata.description ?? null,
            actor_discord_id: ctx.discordId,
        })
        .returning();
    return { amount, balanceAfter, ledger };
}

export async function getApSummary(ctx: Ctx) {
    const { player, stats: row } = await getCharacterSheet(ctx);
    if (!row) throw httpError(404, 'Character stats not found');
    const ledger = await db
        .select()
        .from(apTransactions)
        .where(eq(apTransactions.player_id, player.id))
        .orderBy(desc(apTransactions.created_at))
        .limit(50);
    return {
        characterName: player.name,
        total: row.ap_total,
        available: row.ap_available,
        spent: row.ap_spent,
        ledger,
    };
}

/** Records AP awarded at the table. Only the authenticated character owner can change their selected sheet. */
export async function grantAp(ctx: Ctx, input: { amount: number; reason: string }) {
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 10000) {
        throw httpError(400, 'amount must be an integer from 1 to 10000');
    }
    const reason = input.reason?.trim();
    if (!reason || reason.length > 200) throw httpError(400, 'reason must contain 1 to 200 characters');
    const player = await getSelectedPlayer(ctx);

    return db.transaction(async tx => {
        const [row] = await tx.select().from(stats).where(eq(stats.player_id, player.id)).limit(1).for('update');
        if (!row) throw httpError(404, 'Character stats not found');
        const balanceAfter = row.ap_available + input.amount;
        await tx
            .update(stats)
            .set({ ap_total: row.ap_total + input.amount, ap_available: balanceAfter })
            .where(eq(stats.id, row.id));
        const [ledger] = await tx
            .insert(apTransactions)
            .values({
                player_id: player.id,
                amount: input.amount,
                balance_after: balanceAfter,
                category: 'AP_GRANT',
                description: reason,
                actor_discord_id: ctx.discordId,
            })
            .returning();
        return { characterName: player.name, amount: input.amount, balanceAfter, ledger };
    });
}

export async function raiseAttribute(ctx: Ctx, input: { attribute: string }) {
    const attribute = input.attribute?.toLowerCase();
    if (!attribute || !isAttributeKey(attribute)) throw httpError(400, 'Unknown attribute');
    const player = await getSelectedPlayer(ctx);

    return db.transaction(async tx => {
        const [row] = await tx.select().from(stats).where(eq(stats.player_id, player.id)).limit(1).for('update');
        if (!row) throw httpError(404, 'Character stats not found');
        const current = row[attribute];
        const target = current + 1;
        const cost = calculateAttributeCost(target);
        const ap = await spendApInTransaction(tx, ctx, player.id, cost, {
            category: 'RAISE_ATTRIBUTE',
            referenceType: 'ATTRIBUTE',
            referenceId: attribute.toUpperCase(),
            description: `${attribute.toUpperCase()} ${current} → ${target}`,
        });
        await tx
            .update(stats)
            .set({ [attribute]: target })
            .where(eq(stats.id, row.id));
        if (attribute === 'kk') await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return {
            characterName: player.name,
            attribute,
            previous: current,
            value: target,
            apSpent: cost,
            apAvailable: ap.balanceAfter,
        };
    });
}

function statValue(row: typeof stats.$inferSelect, code: string): number {
    const key = code.toLowerCase();
    return isAttributeKey(key) ? row[key] : 0;
}

export async function raiseTalent(ctx: Ctx, input: { talentId: number }) {
    if (!Number.isInteger(input.talentId) || input.talentId <= 0) throw httpError(400, 'talentId is invalid');
    const player = await getSelectedPlayer(ctx);

    return db.transaction(async tx => {
        const [[talent], [row]] = await Promise.all([
            tx.select().from(talents).where(eq(talents.id, input.talentId)).limit(1),
            tx.select().from(stats).where(eq(stats.player_id, player.id)).limit(1).for('update'),
        ]);
        if (!talent) throw httpError(404, 'Talent not found');
        if (!row) throw httpError(404, 'Character stats not found');
        let [learned] = await tx
            .select()
            .from(playerTalents)
            .where(and(eq(playerTalents.player_id, player.id), eq(playerTalents.talent_id, talent.id)))
            .limit(1)
            .for('update');
        if (!learned) {
            [learned] = await tx
                .insert(playerTalents)
                .values({ player_id: player.id, talent_id: talent.id, ftw: 0 })
                .returning();
        }
        const cap = calculateTalentCap([
            statValue(row, talent.stat1),
            statValue(row, talent.stat2),
            statValue(row, talent.stat3),
        ]);
        const target = learned.ftw + 1;
        if (target > cap) throw httpError(400, `${talent.name} cannot exceed FW ${cap} with the current attributes`);
        const cost = calculateAdvancementCost(talent.advancement_factor, target);
        const ap = await spendApInTransaction(tx, ctx, player.id, cost, {
            category: 'RAISE_TALENT',
            referenceType: 'TALENT',
            referenceId: String(talent.id),
            description: `${talent.name} ${learned.ftw} → ${target}`,
        });
        await tx.update(playerTalents).set({ ftw: target }).where(eq(playerTalents.id, learned.id));
        return { talent, previous: learned.ftw, value: target, cap, apSpent: cost, apAvailable: ap.balanceAfter };
    });
}

export type SupernaturalAbilityType = 'SPELL' | 'LITURGY';

export async function raiseSupernaturalAbility(
    ctx: Ctx,
    input: { abilityType: SupernaturalAbilityType; abilityId: string }
) {
    if (!['SPELL', 'LITURGY'].includes(input.abilityType) || !input.abilityId) {
        throw httpError(400, 'abilityType and abilityId are required');
    }
    const player = await getSelectedPlayer(ctx);

    return db.transaction(async tx => {
        const result =
            input.abilityType === 'SPELL'
                ? await tx
                      .select({
                          learned: playerSpells,
                          name: spells.name,
                          kind: spells.kind,
                          factor: spells.advancement_factor,
                      })
                      .from(playerSpells)
                      .innerJoin(spells, eq(playerSpells.spell_id, spells.id))
                      .where(and(eq(playerSpells.player_id, player.id), eq(playerSpells.spell_id, input.abilityId)))
                      .limit(1)
                      .for('update')
                : await tx
                      .select({
                          learned: playerLiturgies,
                          name: liturgies.name,
                          kind: liturgies.kind,
                          factor: liturgies.advancement_factor,
                      })
                      .from(playerLiturgies)
                      .innerJoin(liturgies, eq(playerLiturgies.liturgy_id, liturgies.id))
                      .where(
                          and(eq(playerLiturgies.player_id, player.id), eq(playerLiturgies.liturgy_id, input.abilityId))
                      )
                      .limit(1)
                      .for('update');
        const ability = result[0];
        if (!ability) throw httpError(404, `${input.abilityType === 'SPELL' ? 'Spell' : 'Liturgy'} is not learned`);
        if (['TRICK', 'BLESSING'].includes(ability.kind)) {
            throw httpError(400, 'Tricks and blessings have no FW to improve');
        }
        if (!ability.factor) throw httpError(409, 'Ability has no advancement factor');
        const target = ability.learned.ftw + 1;
        if (target > 14) throw httpError(400, 'FW 14 requires feature or aspect knowledge to exceed');
        const cost = calculateAdvancementCost(ability.factor, target);
        const ap = await spendApInTransaction(tx, ctx, player.id, cost, {
            category: input.abilityType === 'SPELL' ? 'RAISE_SPELL' : 'RAISE_LITURGY',
            referenceType: input.abilityType,
            referenceId: input.abilityId,
            description: `${ability.name} ${ability.learned.ftw} → ${target}`,
        });
        if (input.abilityType === 'SPELL') {
            await tx
                .update(playerSpells)
                .set({ ftw: target, updated_at: new Date() })
                .where(eq(playerSpells.id, ability.learned.id));
        } else {
            await tx
                .update(playerLiturgies)
                .set({ ftw: target, updated_at: new Date() })
                .where(eq(playerLiturgies.id, ability.learned.id));
        }
        return {
            abilityType: input.abilityType,
            name: ability.name,
            previous: ability.learned.ftw,
            value: target,
            cap: 14,
            apSpent: cost,
            apAvailable: ap.balanceAfter,
        };
    });
}

type Prerequisites = Record<string, unknown>;

async function unmetSpecialAbilityPrerequisites(
    tx: Transaction,
    playerId: number,
    row: typeof stats.$inferSelect,
    prerequisites: Prerequisites
): Promise<string[]> {
    const unmet: string[] = [];
    for (const attribute of ATTRIBUTE_KEYS) {
        const required = prerequisites[attribute];
        if (typeof required === 'number' && row[attribute] < required) {
            unmet.push(`${attribute.toUpperCase()} ${required}`);
        }
    }
    const geOrKk = prerequisites.ge_or_kk;
    if (typeof geOrKk === 'number' && Math.max(row.ge, row.kk) < geOrKk) unmet.push(`GE or KK ${geOrKk}`);

    const requiredAbility = prerequisites.requires;
    if (typeof requiredAbility === 'string') {
        const [owned] = await tx
            .select({ id: playerActionModifications.id })
            .from(playerActionModifications)
            .innerJoin(
                actionModifications,
                eq(playerActionModifications.action_modification_id, actionModifications.id)
            )
            .where(
                and(eq(playerActionModifications.player_id, playerId), eq(actionModifications.name, requiredAbility))
            )
            .limit(1);
        if (!owned) unmet.push(requiredAbility);
    }

    const techniques = Array.isArray(prerequisites.techniques)
        ? prerequisites.techniques.filter((value): value is string => typeof value === 'string')
        : typeof prerequisites.technique === 'string'
          ? [prerequisites.technique]
          : [];
    const requiredValue = typeof prerequisites.value === 'number' ? prerequisites.value : 0;
    if (techniques.length > 0) {
        const ownedWeapons = await tx
            .select({ technique: weapons.combat_technique, at: weapons.at })
            .from(weapons)
            .where(and(eq(weapons.player_id, playerId), inArray(weapons.combat_technique, techniques)));
        const raufenQualifies = techniques.includes('Raufen') && row.attacke_basis >= requiredValue;
        if (!raufenQualifies && !ownedWeapons.some(weapon => weapon.at >= requiredValue)) {
            unmet.push(`${techniques.join('/')} ${requiredValue}`.trim());
        }
    }
    return unmet;
}

async function learnCombatSpecialAbility(ctx: Ctx, input: { abilityId: string }) {
    if (!input.abilityId) throw httpError(400, 'abilityId is required');
    const player = await getSelectedPlayer(ctx);

    return db.transaction(async tx => {
        const [[ability], [row], [existing]] = await Promise.all([
            tx.select().from(actionModifications).where(eq(actionModifications.id, input.abilityId)).limit(1),
            tx.select().from(stats).where(eq(stats.player_id, player.id)).limit(1).for('update'),
            tx
                .select({ id: playerActionModifications.id })
                .from(playerActionModifications)
                .where(
                    and(
                        eq(playerActionModifications.player_id, player.id),
                        eq(playerActionModifications.action_modification_id, input.abilityId)
                    )
                )
                .limit(1),
        ]);
        if (!ability) throw httpError(404, 'Special ability not found');
        if (!row) throw httpError(404, 'Character stats not found');
        if (existing) throw httpError(409, 'Special ability is already learned');
        const unmet = await unmetSpecialAbilityPrerequisites(
            tx,
            player.id,
            row,
            (ability.prerequisites as Prerequisites | null) ?? {}
        );
        if (unmet.length > 0) throw httpError(400, `Prerequisites not met: ${unmet.join(', ')}`);

        let balanceAfter = row.ap_available;
        if (ability.ap_cost > 0) {
            const ap = await spendApInTransaction(tx, ctx, player.id, ability.ap_cost, {
                category: 'LEARN_SPECIAL_ABILITY',
                referenceType: 'SPECIAL_ABILITY',
                referenceId: ability.id,
                description: `Learned ${ability.name}`,
            });
            balanceAfter = ap.balanceAfter;
        } else {
            await tx.insert(apTransactions).values({
                player_id: player.id,
                amount: 0,
                balance_after: balanceAfter,
                category: 'LEARN_SPECIAL_ABILITY',
                reference_type: 'SPECIAL_ABILITY',
                reference_id: ability.id,
                description: `Learned ${ability.name}`,
                actor_discord_id: ctx.discordId,
            });
        }
        const [learned] = await tx
            .insert(playerActionModifications)
            .values({ player_id: player.id, action_modification_id: ability.id, ftw: 0 })
            .onConflictDoNothing({
                target: [playerActionModifications.player_id, playerActionModifications.action_modification_id],
            })
            .returning();
        if (!learned) throw httpError(409, 'Special ability is already learned');
        return { learned, ability, apSpent: ability.ap_cost, apAvailable: balanceAfter };
    });
}

function unmetCatalogAttributePrerequisites(row: typeof stats.$inferSelect, prerequisiteText: string | null) {
    if (!prerequisiteText) return [];
    const unmet = new Set<string>();
    for (const match of prerequisiteText.matchAll(/\b(MU|KL|IN|CH|FF|GE|KO|KK)\s*(\d{1,2})\b/gi)) {
        const attribute = match[1].toLowerCase();
        const required = Number(match[2]);
        if (isAttributeKey(attribute) && row[attribute] < required) unmet.add(`${attribute.toUpperCase()} ${required}`);
    }
    return [...unmet];
}

async function learnCatalogSpecialAbility(ctx: Ctx, input: { abilityId: string; confirmedPrerequisites?: boolean }) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [[ability], [row], [profile], [existing]] = await Promise.all([
            tx.select().from(specialAbilities).where(eq(specialAbilities.id, input.abilityId)).limit(1),
            tx.select().from(stats).where(eq(stats.player_id, player.id)).limit(1).for('update'),
            tx.select().from(supernaturalProfiles).where(eq(supernaturalProfiles.player_id, player.id)).limit(1),
            tx
                .select({ id: playerSpecialAbilities.id })
                .from(playerSpecialAbilities)
                .where(
                    and(
                        eq(playerSpecialAbilities.player_id, player.id),
                        eq(playerSpecialAbilities.special_ability_id, input.abilityId)
                    )
                )
                .limit(1),
        ]);
        if (!ability) throw httpError(404, 'Special ability not found');
        if (!row) throw httpError(404, 'Character stats not found');
        if (existing) throw httpError(409, 'Special ability is already learned');
        if (ability.category === 'MAGICAL' && !profile?.magical_tradition) {
            throw httpError(400, 'A magical tradition is required for magical special abilities');
        }
        if (ability.category === 'KARMAL' && (!profile?.blessed_tradition || !profile.deity)) {
            throw httpError(400, 'A blessed tradition and deity are required for karmic special abilities');
        }
        const unmet = unmetCatalogAttributePrerequisites(row, ability.prerequisites);
        if (unmet.length > 0) throw httpError(400, `Prerequisites not met: ${unmet.join(', ')}`);
        if (ability.requires_confirmation && input.confirmedPrerequisites !== true) {
            throw httpError(
                400,
                `Confirm that the remaining source prerequisites were checked at the table: ${ability.prerequisites}`
            );
        }
        const ap = await spendApInTransaction(tx, ctx, player.id, ability.ap_cost, {
            category: 'LEARN_SPECIAL_ABILITY',
            referenceType: ability.category === 'MAGICAL' ? 'MAGICAL_SPECIAL_ABILITY' : 'KARMAL_SPECIAL_ABILITY',
            referenceId: ability.id,
            description: `Learned ${ability.name}`,
        });
        const [learned] = await tx
            .insert(playerSpecialAbilities)
            .values({ player_id: player.id, special_ability_id: ability.id })
            .onConflictDoNothing({
                target: [playerSpecialAbilities.player_id, playerSpecialAbilities.special_ability_id],
            })
            .returning();
        if (!learned) throw httpError(409, 'Special ability is already learned');
        return { learned, ability, apSpent: ability.ap_cost, apAvailable: ap.balanceAfter };
    });
}

export async function learnSpecialAbility(ctx: Ctx, input: { abilityId: string; confirmedPrerequisites?: boolean }) {
    if (!input.abilityId) throw httpError(400, 'abilityId is required');
    const [combatAbility] = await db
        .select({ id: actionModifications.id })
        .from(actionModifications)
        .where(eq(actionModifications.id, input.abilityId))
        .limit(1);
    return combatAbility ? learnCombatSpecialAbility(ctx, input) : learnCatalogSpecialAbility(ctx, input);
}

export async function listLearnedSpecialAbilities(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    const [combatAbilities, catalogAbilities] = await Promise.all([
        db
            .select({
                id: actionModifications.id,
                name: actionModifications.name,
                description: actionModifications.description,
                category: actionModifications.action_type,
                apCost: actionModifications.ap_cost,
            })
            .from(playerActionModifications)
            .innerJoin(
                actionModifications,
                eq(playerActionModifications.action_modification_id, actionModifications.id)
            )
            .where(eq(playerActionModifications.player_id, player.id))
            .orderBy(actionModifications.name),
        db
            .select({
                id: specialAbilities.id,
                name: specialAbilities.name,
                description: specialAbilities.description,
                category: specialAbilities.category,
                apCost: specialAbilities.ap_cost,
                sourceUrl: specialAbilities.source_url,
            })
            .from(playerSpecialAbilities)
            .innerJoin(specialAbilities, eq(playerSpecialAbilities.special_ability_id, specialAbilities.id))
            .where(eq(playerSpecialAbilities.player_id, player.id))
            .orderBy(specialAbilities.name),
    ]);
    return { characterName: player.name, combatAbilities, catalogAbilities };
}

export async function getAdvancementOptions(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    const [talentRows, spellRows, liturgyRows, combatAbilities, catalogAbilities] = await Promise.all([
        db
            .select({ id: talents.id, name: talents.name, ftw: playerTalents.ftw, factor: talents.advancement_factor })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(eq(playerTalents.player_id, player.id))
            .orderBy(talents.name),
        db
            .select({
                id: spells.id,
                name: spells.name,
                kind: spells.kind,
                ftw: playerSpells.ftw,
                factor: spells.advancement_factor,
            })
            .from(playerSpells)
            .innerJoin(spells, eq(playerSpells.spell_id, spells.id))
            .where(eq(playerSpells.player_id, player.id))
            .orderBy(spells.name),
        db
            .select({
                id: liturgies.id,
                name: liturgies.name,
                kind: liturgies.kind,
                ftw: playerLiturgies.ftw,
                factor: liturgies.advancement_factor,
            })
            .from(playerLiturgies)
            .innerJoin(liturgies, eq(playerLiturgies.liturgy_id, liturgies.id))
            .where(eq(playerLiturgies.player_id, player.id))
            .orderBy(liturgies.name),
        db
            .select({
                id: actionModifications.id,
                name: actionModifications.name,
                apCost: actionModifications.ap_cost,
                category: actionModifications.action_type,
            })
            .from(actionModifications)
            .orderBy(actionModifications.name),
        db
            .select({
                id: specialAbilities.id,
                name: specialAbilities.name,
                apCost: specialAbilities.ap_cost,
                category: specialAbilities.category,
                requiresConfirmation: specialAbilities.requires_confirmation,
            })
            .from(specialAbilities)
            .orderBy(specialAbilities.name),
    ]);
    return {
        attributes: [...ATTRIBUTE_KEYS],
        talents: talentRows,
        spells: spellRows.filter(row => row.kind !== 'TRICK'),
        liturgies: liturgyRows.filter(row => row.kind !== 'BLESSING'),
        specialAbilities: [
            ...combatAbilities.map(ability => ({ ...ability, requiresConfirmation: false })),
            ...catalogAbilities,
        ].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    };
}
