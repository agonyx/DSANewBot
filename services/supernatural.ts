import { and, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import {
    combatantConditions,
    combatantEffects,
    combatantStatuses,
    combatants,
    combatSessions,
    liturgies,
    playerLiturgies,
    players,
    playerSpells,
    playerTalents,
    spells,
    stats,
    supernaturalCastings,
    supernaturalEffects,
    supernaturalProfiles,
    talents,
    weapons,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import { applySoak, parseAndRollDamage, rollDice } from '../utils/combatUtils';
import {
    applyWoundDamage,
    calculateWoundPenalty,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} from '../utils/woundUtils';
import { evaluateProbe } from './talents';
import { getCharacterSheet, getSelectedPlayer } from './characters';
import { getCombatantModifiers } from './combatEffects';
import { spendApInTransaction, type Transaction } from './advancement';
import type { Ctx } from './_ctx';

export type AbilityType = 'SPELL' | 'LITURGY';

type SpellRow = typeof spells.$inferSelect;
type LiturgyRow = typeof liturgies.$inferSelect;

async function getOwnedPlayer(ctx: Ctx, playerId?: number) {
    if (playerId === undefined) return getSelectedPlayer(ctx);
    const [player] = await db
        .select()
        .from(players)
        .where(and(eq(players.id, playerId), eq(players.discord_id, ctx.discordId)))
        .limit(1);
    if (!player) throw httpError(403, 'Caller does not own this character');
    return player;
}

async function getOwnedCharacterSheet(ctx: Ctx, playerId?: number) {
    if (playerId === undefined) return getCharacterSheet(ctx);
    const player = await getOwnedPlayer(ctx, playerId);
    const [statsRow] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
    if (!statsRow) throw httpError(404, 'Character stats not found');
    return { player, stats: statsRow };
}

interface NormalizedAbility {
    id: string;
    type: AbilityType;
    name: string;
    kind: string;
    attrs: [string, string, string] | null;
    traditions: string[];
    resourceCost: number;
    permanentCost: number;
    castingTimeActions: number;
    castingTimeMinutes: number;
    duration: string | null;
    apCost: number;
    effectType: string;
    effectData: Record<string, unknown>;
    description: string | null;
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCatalogLimit(value: number | undefined): number {
    return Number.isInteger(value) ? Math.min(100, Math.max(1, value!)) : 25;
}

function assertAbilityType(value: unknown): asserts value is AbilityType {
    if (value !== 'SPELL' && value !== 'LITURGY') throw httpError(400, 'abilityType must be SPELL or LITURGY');
}

function normalizeSpell(row: SpellRow): NormalizedAbility {
    return {
        id: row.id,
        type: 'SPELL',
        name: row.name,
        kind: row.kind,
        attrs:
            row.probe_attr1 && row.probe_attr2 && row.probe_attr3
                ? [row.probe_attr1, row.probe_attr2, row.probe_attr3]
                : null,
        traditions: row.traditions,
        resourceCost: row.resource_cost,
        permanentCost: row.permanent_cost,
        castingTimeActions: row.casting_time_actions,
        castingTimeMinutes: row.casting_time_minutes,
        duration: row.duration,
        apCost: row.ap_cost,
        effectType: row.effect_type,
        effectData: object(row.effect_data),
        description: row.description,
    };
}

function normalizeLiturgy(row: LiturgyRow): NormalizedAbility {
    return {
        id: row.id,
        type: 'LITURGY',
        name: row.name,
        kind: row.kind,
        attrs:
            row.probe_attr1 && row.probe_attr2 && row.probe_attr3
                ? [row.probe_attr1, row.probe_attr2, row.probe_attr3]
                : null,
        traditions: row.traditions,
        resourceCost: row.resource_cost,
        permanentCost: row.permanent_cost,
        castingTimeActions: row.casting_time_actions,
        castingTimeMinutes: row.casting_time_minutes,
        duration: row.duration,
        apCost: row.ap_cost,
        effectType: row.effect_type,
        effectData: object(row.effect_data),
        description: row.description,
    };
}

function compatibleTradition(traditions: string[], selected: string | null): boolean {
    if (traditions.length === 0 || traditions.some(value => value.toLowerCase().startsWith('allgemein'))) return true;
    if (!selected) return false;
    const normalized = selected.toLocaleLowerCase('de-DE');
    return traditions.some(value => {
        const tradition = value.toLocaleLowerCase('de-DE');
        return (
            tradition === normalized ||
            tradition.startsWith(`${normalized} (`) ||
            normalized.startsWith(`${tradition} (`)
        );
    });
}

export async function getSupernaturalProfile(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    const [profile] = await db
        .select()
        .from(supernaturalProfiles)
        .where(eq(supernaturalProfiles.player_id, player.id))
        .limit(1);
    return {
        playerId: player.id,
        characterName: player.name,
        magicalTradition: profile?.magical_tradition ?? null,
        blessedTradition: profile?.blessed_tradition ?? null,
        deity: profile?.deity ?? null,
        favoredTalents: profile?.favored_talents ?? [],
    };
}

export async function setSupernaturalProfile(
    ctx: Ctx,
    input: {
        magicalTradition?: string | null;
        blessedTradition?: string | null;
        deity?: string | null;
        favoredTalents?: string[];
    }
) {
    const player = await getSelectedPlayer(ctx);
    const existing = await getProfileRow(player.id);
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'string' && value.trim().length > 100) throw httpError(400, `${key} is too long`);
    }
    const favoredTalents = input.favoredTalents
        ? [...new Set(input.favoredTalents.map(value => value.trim()).filter(Boolean))]
        : undefined;
    if (favoredTalents && (favoredTalents.length > 20 || favoredTalents.some(value => value.length > 100))) {
        throw httpError(400, 'favoredTalents supports at most 20 names of at most 100 characters');
    }
    const values = {
        player_id: player.id,
        magical_tradition:
            input.magicalTradition !== undefined
                ? input.magicalTradition?.trim() || null
                : (existing?.magical_tradition ?? null),
        blessed_tradition:
            input.blessedTradition !== undefined
                ? input.blessedTradition?.trim() || null
                : (existing?.blessed_tradition ?? null),
        deity: input.deity !== undefined ? input.deity?.trim() || null : (existing?.deity ?? null),
        favored_talents: favoredTalents ?? existing?.favored_talents ?? [],
    };
    const [row] = await db
        .insert(supernaturalProfiles)
        .values(values)
        .onConflictDoUpdate({
            target: supernaturalProfiles.player_id,
            set: { ...values, updated_at: new Date() },
        })
        .returning();
    return row;
}

export async function listSpellCatalog(_ctx: Ctx, input: { search?: string; kind?: string; limit?: number } = {}) {
    const limit = normalizeCatalogLimit(input.limit);
    const filters = [];
    if (input.search) filters.push(ilike(spells.name, `%${input.search}%`));
    if (input.kind) filters.push(eq(spells.kind, input.kind));
    return db
        .select()
        .from(spells)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(spells.name)
        .limit(limit);
}

export async function getSpell(_ctx: Ctx, spellId: string) {
    const [row] = await db.select().from(spells).where(eq(spells.id, spellId)).limit(1);
    if (!row) throw httpError(404, 'Spell not found');
    return row;
}

export async function listLiturgyCatalog(_ctx: Ctx, input: { search?: string; kind?: string; limit?: number } = {}) {
    const limit = normalizeCatalogLimit(input.limit);
    const filters = [];
    if (input.search) filters.push(ilike(liturgies.name, `%${input.search}%`));
    if (input.kind) filters.push(eq(liturgies.kind, input.kind));
    return db
        .select()
        .from(liturgies)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(liturgies.name)
        .limit(limit);
}

export async function getLiturgy(_ctx: Ctx, liturgyId: string) {
    const [row] = await db.select().from(liturgies).where(eq(liturgies.id, liturgyId)).limit(1);
    if (!row) throw httpError(404, 'Liturgy not found');
    return row;
}

async function getProfileRow(playerId: number) {
    const [profile] = await db
        .select()
        .from(supernaturalProfiles)
        .where(eq(supernaturalProfiles.player_id, playerId))
        .limit(1);
    return profile ?? null;
}

export async function learnSpell(ctx: Ctx, input: { spellId: string }) {
    const player = await getSelectedPlayer(ctx);
    const [[spell], profile] = await Promise.all([
        db.select().from(spells).where(eq(spells.id, input.spellId)).limit(1),
        getProfileRow(player.id),
    ]);
    if (!spell) throw httpError(404, 'Spell not found');
    if (!compatibleTradition(spell.traditions, profile?.magical_tradition ?? null)) {
        throw httpError(400, `Spell is not available to tradition ${profile?.magical_tradition ?? '(unset)'}`);
    }
    return db.transaction(async tx => {
        const [existing] = await tx
            .select({ id: playerSpells.id })
            .from(playerSpells)
            .where(and(eq(playerSpells.player_id, player.id), eq(playerSpells.spell_id, spell.id)))
            .limit(1);
        if (existing) throw httpError(409, 'Spell is already learned');
        const ap = await spendApInTransaction(tx, ctx, player.id, spell.ap_cost, {
            category: 'LEARN_SPELL',
            referenceType: 'SPELL',
            referenceId: spell.id,
            description: `Learned ${spell.name}`,
        });
        const [learned] = await tx
            .insert(playerSpells)
            .values({ player_id: player.id, spell_id: spell.id, ftw: 0 })
            .returning();
        return { learned, spell, apSpent: spell.ap_cost, apAvailable: ap.balanceAfter };
    });
}

export async function learnLiturgy(ctx: Ctx, input: { liturgyId: string }) {
    const player = await getSelectedPlayer(ctx);
    const [[liturgy], profile] = await Promise.all([
        db.select().from(liturgies).where(eq(liturgies.id, input.liturgyId)).limit(1),
        getProfileRow(player.id),
    ]);
    if (!liturgy) throw httpError(404, 'Liturgy not found');
    if (!profile?.blessed_tradition || !profile.deity) {
        throw httpError(400, 'A blessed tradition and deity are required before learning liturgies');
    }
    if (!compatibleTradition(liturgy.traditions, profile.blessed_tradition)) {
        throw httpError(400, `Liturgy is not available to tradition ${profile.blessed_tradition}`);
    }
    return db.transaction(async tx => {
        const [existing] = await tx
            .select({ id: playerLiturgies.id })
            .from(playerLiturgies)
            .where(and(eq(playerLiturgies.player_id, player.id), eq(playerLiturgies.liturgy_id, liturgy.id)))
            .limit(1);
        if (existing) throw httpError(409, 'Liturgy is already learned');
        const ap = await spendApInTransaction(tx, ctx, player.id, liturgy.ap_cost, {
            category: 'LEARN_LITURGY',
            referenceType: 'LITURGY',
            referenceId: liturgy.id,
            description: `Learned ${liturgy.name}`,
        });
        const [learned] = await tx
            .insert(playerLiturgies)
            .values({ player_id: player.id, liturgy_id: liturgy.id, ftw: 0 })
            .returning();
        return { learned, liturgy, apSpent: liturgy.ap_cost, apAvailable: ap.balanceAfter };
    });
}

export async function listLearnedSpells(ctx: Ctx, input: { playerId?: number } = {}) {
    const player = await getOwnedPlayer(ctx, input.playerId);
    return db
        .select({ learned: playerSpells, spell: spells })
        .from(playerSpells)
        .innerJoin(spells, eq(playerSpells.spell_id, spells.id))
        .where(eq(playerSpells.player_id, player.id))
        .orderBy(spells.name);
}

export async function listLearnedLiturgies(ctx: Ctx, input: { playerId?: number } = {}) {
    const player = await getOwnedPlayer(ctx, input.playerId);
    return db
        .select({ learned: playerLiturgies, liturgy: liturgies })
        .from(playerLiturgies)
        .innerJoin(liturgies, eq(playerLiturgies.liturgy_id, liturgies.id))
        .where(eq(playerLiturgies.player_id, player.id))
        .orderBy(liturgies.name);
}

interface TargetState {
    playerId: number | null;
    combatant: typeof combatants.$inferSelect | null;
}

async function resolveTarget(
    casterPlayerId: number,
    input: { targetDiscordId?: string | null; targetCombatantId?: string | null }
): Promise<TargetState> {
    if (input.targetCombatantId) {
        const [combatant] = await db
            .select()
            .from(combatants)
            .where(eq(combatants.id, input.targetCombatantId))
            .limit(1);
        if (!combatant) throw httpError(404, 'Target combatant not found');
        return { playerId: combatant.player_id, combatant };
    }
    let playerId = casterPlayerId;
    if (input.targetDiscordId) {
        const [target] = await db
            .select({ id: players.id })
            .from(players)
            .where(and(eq(players.discord_id, input.targetDiscordId), eq(players.selected, 'YES')))
            .limit(1);
        if (!target) throw httpError(404, 'Target has no selected character');
        playerId = target.id;
    }
    const [active] = await db
        .select({ combatant: combatants })
        .from(combatants)
        .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
        .where(and(eq(combatants.player_id, playerId), inArray(combatSessions.state, ['RUNNING', 'PAUSED'])))
        .limit(1);
    return { playerId, combatant: active?.combatant ?? null };
}

async function loadLearnedAbility(playerId: number, abilityType: AbilityType, abilityId: string) {
    if (abilityType === 'SPELL') {
        const [row] = await db
            .select({ learned: playerSpells, ability: spells })
            .from(playerSpells)
            .innerJoin(spells, eq(playerSpells.spell_id, spells.id))
            .where(and(eq(playerSpells.player_id, playerId), eq(spells.id, abilityId)))
            .limit(1);
        if (!row) throw httpError(404, 'Spell is not learned');
        return { ftw: row.learned.ftw, ability: normalizeSpell(row.ability) };
    }
    const [row] = await db
        .select({ learned: playerLiturgies, ability: liturgies })
        .from(playerLiturgies)
        .innerJoin(liturgies, eq(playerLiturgies.liturgy_id, liturgies.id))
        .where(and(eq(playerLiturgies.player_id, playerId), eq(liturgies.id, abilityId)))
        .limit(1);
    if (!row) throw httpError(404, 'Liturgy is not learned');
    return { ftw: row.learned.ftw, ability: normalizeLiturgy(row.ability) };
}

async function getCasterCombatant(playerId: number) {
    const [row] = await db
        .select({ combatant: combatants, session: combatSessions })
        .from(combatants)
        .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
        .where(and(eq(combatants.player_id, playerId), inArray(combatSessions.state, ['RUNNING', 'PAUSED'])))
        .limit(1);
    return row ?? null;
}

function calculateEffectDuration(ability: NormalizedAbility, qualityLevel: number) {
    const data = ability.effectData;
    const minutesPerQs = Number(data.durationMinutesPerQs ?? 0);
    if (Number.isFinite(minutesPerQs) && minutesPerQs > 0) {
        const minutes = Math.max(1, Math.trunc(minutesPerQs * Math.max(1, qualityLevel)));
        return { type: 'minutes', remaining: minutes, expiresAt: new Date(Date.now() + minutes * 60_000) };
    }
    if (!ability.duration || /sofort/i.test(ability.duration)) {
        return { type: 'instant', remaining: null, expiresAt: null };
    }
    const rounds = ability.duration.match(/(?:QS\s*x\s*)?(\d+)\s*(?:KR|Kampfrunden)/i);
    if (rounds) {
        const remaining = Number(rounds[1]) * (/QS/i.test(ability.duration) ? Math.max(1, qualityLevel) : 1);
        return { type: 'rounds', remaining, expiresAt: null };
    }
    const minutes = ability.duration.match(/(?:QS\s*x\s*)?(\d+)\s*(?:in\s+)?Minuten?/i);
    if (minutes) {
        const remaining = Number(minutes[1]) * (/QS/i.test(ability.duration) ? Math.max(1, qualityLevel) : 1);
        return { type: 'minutes', remaining, expiresAt: new Date(Date.now() + remaining * 60_000) };
    }
    if (/permanent|aufrechterhaltend/i.test(ability.duration)) {
        return { type: 'permanent', remaining: null, expiresAt: null };
    }
    return { type: 'tracked', remaining: null, expiresAt: null };
}

async function synchronizeTargetHp(tx: Transaction, target: TargetState, input: { hp: number; wounds?: number }) {
    if (target.combatant) {
        await tx
            .update(combatants)
            .set({ current_hp: input.hp, ...(input.wounds !== undefined ? { wounds: input.wounds } : {}) })
            .where(eq(combatants.id, target.combatant.id));
    }
    if (target.playerId) {
        await tx
            .update(stats)
            .set({ le_current: input.hp, ...(input.wounds !== undefined ? { wounds: input.wounds } : {}) })
            .where(eq(stats.player_id, target.playerId));
    }
}

async function applyAbilityEffect(
    tx: Transaction,
    input: {
        castingId: string;
        casterPlayerId: number;
        ability: NormalizedAbility;
        qualityLevel: number;
        paidCost: number;
        target: TargetState;
    }
) {
    const { ability, target } = input;
    const duration = calculateEffectDuration(ability, input.qualityLevel);
    const data = ability.effectData;
    let result: Record<string, unknown> = { type: ability.effectType, narrative: ability.description };

    if (ability.effectType === 'DAMAGE') {
        if (!target.playerId && !target.combatant) throw httpError(400, 'Damage effect requires a character target');
        const [targetStats] = target.playerId
            ? await tx.select().from(stats).where(eq(stats.player_id, target.playerId)).limit(1)
            : [null];
        const hp = target.combatant?.current_hp ?? targetStats?.le_current;
        if (hp === undefined || hp === null) throw httpError(400, 'Target has no life-point pool');
        const formula = typeof data.formula === 'string' ? data.formula : '1w6';
        const rawDamage = parseAndRollDamage(formula) + Number(data.qsMultiplier ?? 0) * input.qualityLevel;
        const armor = data.ignoresMundaneArmor ? 0 : (targetStats?.ruestungsschutz ?? 0);
        const damage = applySoak(rawDamage, armor);
        const threshold =
            target.combatant?.wound_threshold ??
            (targetStats ? calculateWoundThreshold(targetStats.ko, targetStats.wound_threshold_modifier) : 0);
        const currentWounds = target.combatant?.wounds ?? targetStats?.wounds ?? 0;
        const woundResult = applyWoundDamage(currentWounds, damage, threshold);
        const hpAfter = hp - damage;
        await synchronizeTargetHp(tx, target, { hp: hpAfter, wounds: woundResult.totalWounds });
        result = { type: 'DAMAGE', rawDamage, armor, damage, hpAfter, woundsInflicted: woundResult.woundsInflicted };
        const chance = object(data.secondaryChance);
        if (
            target.combatant &&
            typeof data.secondaryStatus === 'string' &&
            Number.isInteger(chance.die) &&
            Number.isInteger(chance.maximum) &&
            rollDice(chance.die as number) <= (chance.maximum as number)
        ) {
            await tx
                .insert(combatantStatuses)
                .values({
                    combatant_id: target.combatant.id,
                    status_type: data.secondaryStatus,
                    source: ability.name,
                    duration_rounds: 3,
                })
                .onConflictDoUpdate({
                    target: [combatantStatuses.combatant_id, combatantStatuses.status_type],
                    set: { source: ability.name, duration_rounds: 3, updated_at: new Date() },
                });
            result.secondaryStatus = data.secondaryStatus;
        }
    } else if (ability.effectType === 'HEAL') {
        if (!target.playerId) throw httpError(400, 'Healing effect requires a player target');
        const [targetStats] = await tx.select().from(stats).where(eq(stats.player_id, target.playerId)).limit(1);
        if (!targetStats) throw httpError(404, 'Target stats not found');
        const amount = data.resourceScaled ? input.paidCost : Number(data.amount ?? input.qualityLevel);
        const hpAfter = Math.min(targetStats.le_max, targetStats.le_current + Math.max(0, Math.trunc(amount)));
        await synchronizeTargetHp(tx, target, { hp: hpAfter });
        result = { type: 'HEAL', amount: hpAfter - targetStats.le_current, hpAfter };
    } else if (ability.effectType === 'BUFF') {
        if (!target.combatant) throw httpError(400, 'This buff requires a target in an active combat');
        const durationRounds =
            duration.type === 'rounds'
                ? duration.remaining
                : duration.type === 'minutes' && duration.remaining
                  ? duration.remaining * 30
                  : null;
        const [effect] = await tx
            .insert(combatantEffects)
            .values({
                combatant_id: target.combatant.id,
                effect_type: `ability:${input.castingId}`,
                source: ability.name,
                at_modifier: Number(data.atModifier ?? 0),
                pa_modifier: Number(data.paModifier ?? 0),
                damage_modifier: Number(data.damageModifier ?? 0),
                armor_modifier: Number(object(data.armorByCost)[String(input.paidCost)] ?? data.armorModifier ?? 0),
                check_modifier: Number(data.checkModifier ?? 0),
                duration_rounds: durationRounds,
            })
            .returning();
        result = { type: 'BUFF', effectId: effect.id, durationRounds };
    } else if (ability.effectType === 'CONDITION') {
        if (!target.combatant) throw httpError(400, 'This condition requires a target in an active combat');
        const levels = Array.isArray(data.levelsByQs) ? data.levelsByQs : [];
        const level = Math.max(1, Math.min(4, Number(levels[input.qualityLevel - 1] ?? data.level ?? 1)));
        const durationRounds =
            duration.type === 'minutes' && duration.remaining
                ? duration.remaining * 30
                : duration.type === 'rounds'
                  ? duration.remaining
                  : null;
        await tx
            .insert(combatantConditions)
            .values({
                combatant_id: target.combatant.id,
                condition_type: String(data.conditionType ?? 'verwirrung'),
                level,
                source: ability.name,
                duration_type: durationRounds ? 'rounds' : 'permanent',
                duration_remaining: durationRounds,
            })
            .onConflictDoUpdate({
                target: [combatantConditions.combatant_id, combatantConditions.condition_type],
                set: {
                    level,
                    source: ability.name,
                    duration_type: durationRounds ? 'rounds' : 'permanent',
                    duration_remaining: durationRounds,
                    updated_at: new Date(),
                },
            });
        result = { type: 'CONDITION', conditionType: data.conditionType, level, durationRounds };
    } else if (ability.effectType === 'STATUS') {
        if (!target.combatant) throw httpError(400, 'This status requires a target in an active combat');
        const durationRounds = duration.type === 'rounds' ? duration.remaining : null;
        await tx
            .insert(combatantStatuses)
            .values({
                combatant_id: target.combatant.id,
                status_type: String(data.statusType),
                source: ability.name,
                duration_rounds: durationRounds,
                effect_data: object(data.statusEffectData),
            })
            .onConflictDoUpdate({
                target: [combatantStatuses.combatant_id, combatantStatuses.status_type],
                set: {
                    source: ability.name,
                    duration_rounds: durationRounds,
                    effect_data: object(data.statusEffectData),
                    updated_at: new Date(),
                },
            });
        result = { type: 'STATUS', statusType: data.statusType, durationRounds };
    }

    const active = duration.type !== 'instant';
    const [effectRecord] = await tx
        .insert(supernaturalEffects)
        .values({
            casting_id: input.castingId,
            caster_player_id: input.casterPlayerId,
            target_player_id: target.playerId,
            target_combatant_id: target.combatant?.id ?? null,
            ability_type: ability.type,
            ability_name: ability.name,
            effect_type: ability.effectType,
            effect_data: result,
            duration_type: duration.type,
            duration_remaining: duration.remaining,
            expires_at: duration.expiresAt,
            active,
        })
        .returning();
    return { ...result, trackedEffectId: effectRecord.id, active };
}

export interface CastAbilityInput {
    abilityType: AbilityType;
    abilityId: string;
    modifier?: number;
    resourceAmount?: number;
    targetDiscordId?: string | null;
    targetCombatantId?: string | null;
    casterPlayerId?: number;
}

export async function castAbility(ctx: Ctx, input: CastAbilityInput) {
    assertAbilityType(input.abilityType);
    const modifier = input.modifier ?? 0;
    if (!Number.isInteger(modifier) || modifier < -20 || modifier > 20) {
        throw httpError(400, 'modifier must be an integer from -20 to 20');
    }
    const { player, stats: casterStats } = await getOwnedCharacterSheet(ctx, input.casterPlayerId);
    if (!casterStats) throw httpError(404, 'Character stats not found');
    const [{ ftw, ability }, profile, target, casterCombat] = await Promise.all([
        loadLearnedAbility(player.id, input.abilityType, input.abilityId),
        getProfileRow(player.id),
        resolveTarget(player.id, input),
        getCasterCombatant(player.id),
    ]);
    const selectedTradition =
        ability.type === 'SPELL' ? (profile?.magical_tradition ?? null) : (profile?.blessed_tradition ?? null);
    if (!compatibleTradition(ability.traditions, selectedTradition)) {
        throw httpError(400, `${ability.name} is incompatible with the current tradition`);
    }
    if (ability.type === 'LITURGY' && (!profile?.blessed_tradition || !profile.deity)) {
        throw httpError(400, 'A blessed tradition and deity are required');
    }
    if (isIncapacitatedByWounds(casterStats.wounds)) {
        throw httpError(400, 'The caster is incapacitated by wounds');
    }
    if (casterCombat?.session.state === 'PAUSED') throw httpError(409, 'Combat is paused');
    if (casterCombat?.session.state === 'RUNNING') {
        const activeId = casterCombat.session.turn_order[casterCombat.session.current_turn_index];
        if (activeId !== casterCombat.combatant.id) throw httpError(400, "It is not the caster's turn");
        if (!target.combatant || target.combatant.session_id !== casterCombat.combatant.session_id) {
            throw httpError(400, 'Combat spell target must be in the same encounter');
        }
    }

    const effectData = ability.effectData;
    if (effectData.target === 'SELF' && target.playerId !== player.id) {
        throw httpError(400, `${ability.name} can target only the caster`);
    }
    let resourceCost = ability.resourceCost;
    if (effectData.resourceScaled) {
        const minimum = Math.max(1, Number(effectData.minimumAmount ?? ability.resourceCost));
        const requested = input.resourceAmount ?? minimum;
        if (!Number.isInteger(requested) || requested < minimum || requested > Math.max(minimum, ftw)) {
            throw httpError(400, `resourceAmount must be ${minimum}..${Math.max(minimum, ftw)}`);
        }
        resourceCost = requested;
    } else if (effectData.resourceInputRequired) {
        const requested = input.resourceAmount;
        if (!Number.isInteger(requested) || requested! < 1 || requested! > 100) {
            throw httpError(400, 'resourceAmount must be an integer from 1 to 100 for this ability');
        }
        resourceCost = requested!;
    } else if (Array.isArray(effectData.resourceOptions)) {
        const options = effectData.resourceOptions
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0);
        const requested = input.resourceAmount ?? options[0];
        if (!options.includes(requested)) {
            throw httpError(400, `resourceAmount must be one of ${options.join(', ')}`);
        }
        resourceCost = requested;
    } else if (input.resourceAmount !== undefined) {
        throw httpError(400, 'resourceAmount is only valid for variable-cost abilities');
    }

    let conditionModifier = 0;
    if (casterCombat) {
        const combatState = await getCombatantModifiers(casterCombat.combatant);
        const combatModifiers = combatState.modifiers;
        if (combatModifiers.prohibitsActions) throw httpError(400, 'The caster is barred from acting');
        conditionModifier = combatState.unencumberedCheckModifier;
    }
    const woundPenalty = calculateWoundPenalty(casterStats.wounds);
    const rolls: [number, number, number] | null = ability.attrs ? [rollDice(20), rollDice(20), rollDice(20)] : null;
    const evaluation =
        ability.attrs && rolls
            ? evaluateProbe({
                  attrCodes: ability.attrs,
                  attrValues: ability.attrs.map(code =>
                      Math.max(
                          0,
                          ((casterStats as Record<string, number>)[code.toLowerCase()] || 8) -
                              woundPenalty +
                              conditionModifier
                      )
                  ) as [number, number, number],
                  baseFtw: ftw,
                  modifier,
                  rolls,
              })
            : { effectiveFtw: ftw, remainingFtw: ftw, success: true, qs: 1, checkResults: [] };
    const success = evaluation.success;
    const paidCost = success ? resourceCost : Math.ceil(resourceCost / 2);
    const currentColumn = ability.type === 'SPELL' ? 'asp_current' : 'kap_current';
    const maxColumn = ability.type === 'SPELL' ? 'asp_max' : 'kap_max';
    const current = casterStats[currentColumn];
    const maximum = casterStats[maxColumn];
    if (current < paidCost) throw httpError(400, `Not enough ${ability.type === 'SPELL' ? 'AsP' : 'KaP'}`);
    if (success && ability.permanentCost > 0 && maximum - ability.permanentCost < 0) {
        throw httpError(400, 'Permanent resource cost exceeds the maximum pool');
    }

    const delayMs = ability.castingTimeMinutes * 60_000 + Math.max(0, ability.castingTimeActions - 1) * 2_000;
    const pending = success && delayMs > 0;
    return db.transaction(async tx => {
        const [lockedStats] = await tx.select().from(stats).where(eq(stats.id, casterStats.id)).limit(1).for('update');
        if (!lockedStats || lockedStats[currentColumn] < paidCost) {
            throw httpError(409, 'Resource balance changed; retry the casting');
        }
        if (effectData.oncePerDay && target.playerId) {
            if (target.playerId !== player.id) {
                await tx
                    .select({ id: stats.id })
                    .from(stats)
                    .where(eq(stats.player_id, target.playerId))
                    .limit(1)
                    .for('update');
            }
            const [priorUse] = await tx
                .select({ id: supernaturalCastings.id })
                .from(supernaturalCastings)
                .where(
                    and(
                        eq(supernaturalCastings.ability_name, ability.name),
                        eq(supernaturalCastings.target_player_id, target.playerId),
                        eq(supernaturalCastings.status, 'COMPLETED'),
                        gte(supernaturalCastings.completed_at, new Date(Date.now() - 24 * 60 * 60 * 1000))
                    )
                )
                .limit(1);
            if (priorUse) throw httpError(409, `${ability.name} can affect this character only once per 24 hours`);
        }
        const nextMax = success ? Math.max(0, lockedStats[maxColumn] - ability.permanentCost) : lockedStats[maxColumn];
        const nextCurrent = Math.min(nextMax, lockedStats[currentColumn] - paidCost);
        await tx
            .update(stats)
            .set({ [currentColumn]: nextCurrent, [maxColumn]: nextMax })
            .where(eq(stats.id, lockedStats.id));

        const probeResult = {
            rolls,
            modifier,
            woundPenalty,
            conditionModifier,
            ...evaluation,
        };
        const [casting] = await tx
            .insert(supernaturalCastings)
            .values({
                player_id: player.id,
                ability_type: ability.type,
                spell_id: ability.type === 'SPELL' ? ability.id : null,
                liturgy_id: ability.type === 'LITURGY' ? ability.id : null,
                ability_name: ability.name,
                target_player_id: target.playerId,
                target_combatant_id: target.combatant?.id ?? null,
                status: !success ? 'FAILED' : pending ? 'PENDING' : 'COMPLETED',
                resource_cost: paidCost,
                probe_result: probeResult,
                completes_at: pending ? new Date(Date.now() + delayMs) : null,
                completed_at: success && !pending ? new Date() : null,
            })
            .returning();
        if (casterCombat?.session.state === 'RUNNING') {
            const [spent] = await tx
                .update(combatants)
                .set({
                    action_spent: true,
                    ongoing_action: pending
                        ? {
                              type: ability.type,
                              label: ability.name,
                              startedAt: new Date().toISOString(),
                              completesAt:
                                  casting.completes_at?.toISOString() ?? new Date(Date.now() + delayMs).toISOString(),
                          }
                        : null,
                })
                .where(and(eq(combatants.id, casterCombat.combatant.id), eq(combatants.action_spent, false)))
                .returning({ id: combatants.id });
            if (!spent) throw httpError(409, "The caster has already spent this turn's action");
        }
        if (pending && casterCombat) {
            await tx.insert(combatantEffects).values({
                combatant_id: casterCombat.combatant.id,
                effect_type: `casting:${casting.id}`,
                source: `Concentrating on ${ability.name}`,
                prohibits_actions: true,
                duration_rounds: null,
            });
        }
        let effectResult: Record<string, unknown> = {};
        if (success && !pending) {
            effectResult = await applyAbilityEffect(tx, {
                castingId: casting.id,
                casterPlayerId: player.id,
                ability,
                qualityLevel: evaluation.qs,
                paidCost,
                target,
            });
            await tx
                .update(supernaturalCastings)
                .set({ effect_result: effectResult, updated_at: new Date() })
                .where(eq(supernaturalCastings.id, casting.id));
        }
        return {
            casting: { ...casting, effect_result: effectResult },
            ability: { id: ability.id, name: ability.name, type: ability.type, kind: ability.kind },
            success,
            qualityLevel: evaluation.qs,
            paidCost,
            resourceBefore: lockedStats[currentColumn],
            resourceAfter: nextCurrent,
            permanentCost: success ? ability.permanentCost : 0,
            pending,
            combatSessionId: casterCombat?.session.id ?? null,
            combatChannelId: casterCombat?.session.channel_id ?? null,
            probeResult,
            effectResult,
        };
    });
}

export async function cancelCasting(ctx: Ctx, castingId: string) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [casting] = await tx
            .select()
            .from(supernaturalCastings)
            .where(and(eq(supernaturalCastings.id, castingId), eq(supernaturalCastings.player_id, player.id)))
            .limit(1)
            .for('update');
        if (!casting) throw httpError(404, 'Casting not found');
        if (casting.status !== 'PENDING') throw httpError(400, `Casting is ${casting.status.toLowerCase()}`);

        const [lockedStats] = await tx
            .select()
            .from(stats)
            .where(eq(stats.player_id, player.id))
            .limit(1)
            .for('update');
        if (!lockedStats) throw httpError(404, 'Character stats not found');
        const refund = Math.floor(casting.resource_cost / 2);
        const currentColumn = casting.ability_type === 'SPELL' ? 'asp_current' : 'kap_current';
        const maxColumn = casting.ability_type === 'SPELL' ? 'asp_max' : 'kap_max';
        const resourceAfter = Math.min(lockedStats[maxColumn], lockedStats[currentColumn] + refund);
        await tx
            .update(stats)
            .set({ [currentColumn]: resourceAfter })
            .where(eq(stats.id, lockedStats.id));
        const effectResult = { refund, retainedCost: casting.resource_cost - refund };
        await tx.delete(combatantEffects).where(eq(combatantEffects.effect_type, `casting:${casting.id}`));
        const [updated] = await tx
            .update(supernaturalCastings)
            .set({ status: 'CANCELLED', effect_result: effectResult, completed_at: new Date(), updated_at: new Date() })
            .where(eq(supernaturalCastings.id, casting.id))
            .returning();
        return { casting: updated, refund, retainedCost: casting.resource_cost - refund, resourceAfter };
    });
}

async function loadAbilityByCasting(casting: typeof supernaturalCastings.$inferSelect) {
    if (casting.ability_type === 'SPELL' && casting.spell_id) {
        const [row] = await db.select().from(spells).where(eq(spells.id, casting.spell_id)).limit(1);
        if (row) return normalizeSpell(row);
    }
    if (casting.ability_type === 'LITURGY' && casting.liturgy_id) {
        const [row] = await db.select().from(liturgies).where(eq(liturgies.id, casting.liturgy_id)).limit(1);
        if (row) return normalizeLiturgy(row);
    }
    throw httpError(404, 'Casting ability no longer exists');
}

export async function completeCasting(ctx: Ctx, castingId: string) {
    const player = await getSelectedPlayer(ctx);
    const [casting] = await db
        .select()
        .from(supernaturalCastings)
        .where(and(eq(supernaturalCastings.id, castingId), eq(supernaturalCastings.player_id, player.id)))
        .limit(1);
    if (!casting) throw httpError(404, 'Casting not found');
    if (casting.status !== 'PENDING') throw httpError(400, `Casting is ${casting.status.toLowerCase()}`);
    if (!casting.completes_at || casting.completes_at.getTime() > Date.now()) {
        throw httpError(409, `Casting completes at ${casting.completes_at?.toISOString()}`);
    }
    const ability = await loadAbilityByCasting(casting);
    const target: TargetState = {
        playerId: casting.target_player_id,
        combatant: casting.target_combatant_id
            ? ((await db.select().from(combatants).where(eq(combatants.id, casting.target_combatant_id)).limit(1))[0] ??
              null)
            : null,
    };
    const probe = object(casting.probe_result);
    const qualityLevel = Math.max(1, Number(probe.qs ?? 1));
    return db.transaction(async tx => {
        const [locked] = await tx
            .select({ status: supernaturalCastings.status })
            .from(supernaturalCastings)
            .where(eq(supernaturalCastings.id, casting.id))
            .limit(1)
            .for('update');
        if (locked?.status !== 'PENDING') throw httpError(409, 'Casting was already completed or cancelled');
        const effectResult = await applyAbilityEffect(tx, {
            castingId: casting.id,
            casterPlayerId: player.id,
            ability,
            qualityLevel,
            paidCost: casting.resource_cost,
            target,
        });
        await tx.delete(combatantEffects).where(eq(combatantEffects.effect_type, `casting:${casting.id}`));
        const [updated] = await tx
            .update(supernaturalCastings)
            .set({ status: 'COMPLETED', effect_result: effectResult, completed_at: new Date(), updated_at: new Date() })
            .where(eq(supernaturalCastings.id, casting.id))
            .returning();
        return { casting: updated, effectResult };
    });
}

export async function listCastings(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    return db
        .select()
        .from(supernaturalCastings)
        .where(eq(supernaturalCastings.player_id, player.id))
        .orderBy(desc(supernaturalCastings.created_at))
        .limit(50);
}

export async function listSupernaturalEffects(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    await db
        .update(supernaturalEffects)
        .set({ active: false, updated_at: new Date() })
        .where(and(eq(supernaturalEffects.active, true), lte(supernaturalEffects.expires_at, new Date())));
    return db
        .select()
        .from(supernaturalEffects)
        .where(
            sql`${supernaturalEffects.caster_player_id} = ${player.id} OR ${supernaturalEffects.target_player_id} = ${player.id}`
        )
        .orderBy(desc(supernaturalEffects.created_at))
        .limit(100);
}

export async function invokeMiracle(
    ctx: Ctx,
    input: { mode: 'TALENT' | 'AT' | 'PA'; talentId?: number; combatantId?: string }
) {
    if (!['TALENT', 'AT', 'PA'].includes(input.mode)) throw httpError(400, 'mode must be TALENT, AT, or PA');
    const { player, stats: casterStats } = await getCharacterSheet(ctx);
    if (!casterStats) throw httpError(404, 'Character stats not found');
    const profile = await getProfileRow(player.id);
    if (!profile?.blessed_tradition || !profile.deity) {
        throw httpError(400, 'A blessed tradition and deity are required for miracles');
    }
    if (casterStats.kap_current < 4) throw httpError(400, 'A miracle requires 4 KaP');
    if (isIncapacitatedByWounds(casterStats.wounds)) {
        throw httpError(400, 'The character is incapacitated by wounds');
    }
    const casterCombat = await getCasterCombatant(player.id);
    const conditionModifier = casterCombat
        ? (await getCombatantModifiers(casterCombat.combatant)).modifiers.checkModifier
        : -casterStats.belastung;
    const woundPenalty = calculateWoundPenalty(casterStats.wounds);

    let result: Record<string, unknown>;
    if (input.mode === 'TALENT') {
        if (!Number.isInteger(input.talentId)) throw httpError(400, 'talentId is required for a talent miracle');
        const [learned] = await db
            .select({ ftw: playerTalents.ftw, talent: talents })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(and(eq(playerTalents.player_id, player.id), eq(talents.id, input.talentId!)))
            .limit(1);
        if (!learned) throw httpError(404, 'Talent not found on character');
        if (
            !profile.favored_talents.some(
                name => name.toLocaleLowerCase('de-DE') === learned.talent.name.toLocaleLowerCase('de-DE')
            )
        ) {
            throw httpError(400, `${learned.talent.name} is not favored by ${profile.deity}`);
        }
        const attrs = [learned.talent.stat1, learned.talent.stat2, learned.talent.stat3] as [string, string, string];
        const rolls: [number, number, number] = [rollDice(20), rollDice(20), rollDice(20)];
        const evaluated = evaluateProbe({
            attrCodes: attrs,
            attrValues: attrs.map(code =>
                Math.max(
                    0,
                    ((casterStats as Record<string, number>)[code.toLowerCase()] || 8) -
                        woundPenalty +
                        conditionModifier
                )
            ) as [number, number, number],
            baseFtw: learned.ftw,
            modifier: 2,
            rolls,
        });
        result = { mode: 'TALENT', talent: learned.talent.name, rolls, ...evaluated };
    } else {
        if (!input.combatantId) throw httpError(400, 'combatantId is required for a combat miracle');
        const [row] = await db
            .select({ combatant: combatants, session: combatSessions })
            .from(combatants)
            .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
            .where(and(eq(combatants.id, input.combatantId), eq(combatants.player_id, player.id)))
            .limit(1);
        if (!row) throw httpError(404, 'Owned combatant not found');
        if (row.session.state !== 'RUNNING') throw httpError(409, 'Combat miracle requires a running encounter');
        if (input.mode === 'AT') {
            const activeId = row.session.turn_order[row.session.current_turn_index];
            if (activeId !== row.combatant.id) throw httpError(400, 'An AT miracle must be invoked on your turn');
        }
        const techniques = await db
            .select({ name: weapons.combat_technique })
            .from(weapons)
            .where(and(eq(weapons.player_id, player.id), eq(weapons.is_equipped, 'Y')));
        const favored = new Set(profile.favored_talents.map(name => name.toLocaleLowerCase('de-DE')));
        const favoredTechnique = techniques
            .map(value => value.name)
            .find(name => name && favored.has(name.toLocaleLowerCase('de-DE')));
        if (!favoredTechnique) {
            throw httpError(400, `No equipped combat technique is favored by ${profile.deity}`);
        }
        result = { mode: input.mode, combatantId: row.combatant.id, modifier: 2, combatTechnique: favoredTechnique };
    }

    return db.transaction(async tx => {
        const [locked] = await tx.select().from(stats).where(eq(stats.id, casterStats.id)).limit(1).for('update');
        if (!locked || locked.kap_current < 4) throw httpError(409, 'KaP balance changed; retry the miracle');
        await tx
            .update(stats)
            .set({ kap_current: locked.kap_current - 4 })
            .where(eq(stats.id, locked.id));
        if (input.mode !== 'TALENT') {
            await tx
                .insert(combatantEffects)
                .values({
                    combatant_id: input.combatantId!,
                    effect_type: input.mode === 'AT' ? 'miracle_at' : 'miracle_pa',
                    source: `Miracle of ${profile.deity}`,
                    at_modifier: input.mode === 'AT' ? 2 : 0,
                    pa_modifier: input.mode === 'PA' ? 2 : 0,
                    duration_rounds: null,
                })
                .onConflictDoUpdate({
                    target: [combatantEffects.combatant_id, combatantEffects.effect_type],
                    set: {
                        source: `Miracle of ${profile.deity}`,
                        at_modifier: input.mode === 'AT' ? 2 : 0,
                        pa_modifier: input.mode === 'PA' ? 2 : 0,
                        updated_at: new Date(),
                    },
                });
        }
        return { ...result, deity: profile.deity, kapCost: 4, kapAfter: locked.kap_current - 4 };
    });
}
