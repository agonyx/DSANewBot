import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import {
    actionModifications,
    campaignRecords,
    characterRecords,
    items,
    liturgies,
    partyMemberships,
    playerActionModifications,
    playerLiturgies,
    players,
    playerSpecialAbilities,
    playerSpells,
    playerTalents,
    specialAbilities,
    spells,
    stats,
    talents,
    wallets,
    weapons,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    advanceProgress,
    normalizeCharacterRecord,
    normalizeProgress,
    type CharacterRecordKind,
} from '../utils/characterRecordUtils';
import { normalizeName, normalizeText } from '../utils/campaignUtils';
import { parseCharacterImport, type CharacterImportResult } from '../utils/characterImport';
import type { Ctx } from './_ctx';
import { getSelectedPlayer } from './characters';
import { requireDmGuild } from './guildAuth';

const MAX_RECORDS_PER_KIND = 100;

function validationError(error: unknown): never {
    if (error instanceof Error) throw httpError(400, error.message);
    throw httpError(400, 'Invalid character record');
}

async function selectedPlayerId(ctx: Ctx): Promise<number> {
    return (await getSelectedPlayer(ctx)).id;
}

export async function createCharacterRecord(
    ctx: Ctx,
    input: {
        kind: CharacterRecordKind;
        name: string;
        description?: string;
        status?: string;
        data?: Record<string, unknown>;
    }
) {
    const playerId = await selectedPlayerId(ctx);
    let record: ReturnType<typeof normalizeCharacterRecord>;
    try {
        record = normalizeCharacterRecord(input.kind, input);
    } catch (error) {
        return validationError(error);
    }
    const current = await db
        .select({ id: characterRecords.id })
        .from(characterRecords)
        .where(and(eq(characterRecords.player_id, playerId), eq(characterRecords.kind, input.kind)))
        .limit(MAX_RECORDS_PER_KIND);
    if (current.length >= MAX_RECORDS_PER_KIND) {
        throw httpError(
            409,
            `A character can save at most ${MAX_RECORDS_PER_KIND} ${input.kind.toLowerCase()} records`
        );
    }
    const [created] = await db
        .insert(characterRecords)
        .values({
            player_id: playerId,
            ...record,
            created_by_discord_id: ctx.discordId,
        })
        .returning();
    return created;
}

export async function listCharacterRecords(ctx: Ctx, kind?: CharacterRecordKind) {
    const playerId = await selectedPlayerId(ctx);
    const condition = kind
        ? and(eq(characterRecords.player_id, playerId), eq(characterRecords.kind, kind))
        : eq(characterRecords.player_id, playerId);
    return db
        .select()
        .from(characterRecords)
        .where(condition)
        .orderBy(asc(characterRecords.kind), asc(characterRecords.name));
}

export async function getCharacterRecord(ctx: Ctx, recordId: string, kind?: CharacterRecordKind) {
    const playerId = await selectedPlayerId(ctx);
    const conditions = [eq(characterRecords.player_id, playerId), eq(characterRecords.id, recordId)];
    if (kind) conditions.push(eq(characterRecords.kind, kind));
    const [record] = await db
        .select()
        .from(characterRecords)
        .where(and(...conditions))
        .limit(1);
    if (!record) throw httpError(404, 'Character record not found');
    return record;
}

export async function updateCharacterRecord(
    ctx: Ctx,
    input: {
        recordId: string;
        kind?: CharacterRecordKind;
        name?: string;
        status?: string;
        data?: Record<string, unknown>;
    }
) {
    const existing = await getCharacterRecord(ctx, input.recordId, input.kind);
    let name = input.name;
    try {
        if (name !== undefined) name = normalizeName(name);
    } catch (error) {
        return validationError(error);
    }
    const [updated] = await db
        .update(characterRecords)
        .set({
            ...(name === undefined ? {} : { name }),
            ...(input.status === undefined ? {} : { status: input.status.toUpperCase() }),
            ...(input.data === undefined ? {} : { data: input.data }),
            updated_at: new Date(),
        })
        .where(and(eq(characterRecords.id, existing.id), eq(characterRecords.updated_at, existing.updated_at)))
        .returning();
    if (!updated) throw httpError(409, 'Character record changed; retry the command');
    return updated;
}

export async function deleteCharacterRecord(ctx: Ctx, recordId: string, kind?: CharacterRecordKind) {
    const existing = await getCharacterRecord(ctx, recordId, kind);
    const [deleted] = await db.delete(characterRecords).where(eq(characterRecords.id, existing.id)).returning();
    return deleted;
}

export async function setCharacterBackground(ctx: Ctx, input: { culture: string; profession: string; notes?: string }) {
    const playerId = await selectedPlayerId(ctx);
    let data: Record<string, unknown>;
    try {
        data = {
            culture: normalizeName(input.culture, 'culture'),
            profession: normalizeName(input.profession, 'profession'),
            notes: normalizeText(input.notes, 'notes', 1000),
        };
    } catch (error) {
        return validationError(error);
    }
    const [record] = await db
        .insert(characterRecords)
        .values({
            player_id: playerId,
            kind: 'BACKGROUND',
            name: 'Profile',
            data,
            created_by_discord_id: ctx.discordId,
        })
        .onConflictDoUpdate({
            target: [characterRecords.player_id, characterRecords.kind, characterRecords.name],
            set: { data, updated_at: new Date() },
        })
        .returning();
    return record;
}

export async function startCraftingProject(
    ctx: Ctx,
    input: { name: string; description?: string; materials?: string; target: number }
) {
    let progress: { progress: number; target: number };
    try {
        progress = normalizeProgress(0, input.target);
    } catch (error) {
        return validationError(error);
    }
    return createCharacterRecord(ctx, {
        kind: 'CRAFTING_PROJECT',
        name: input.name,
        description: input.description,
        data: { ...progress, materials: normalizeText(input.materials, 'materials', 1000) },
    });
}

export async function advanceCharacterProject(
    ctx: Ctx,
    recordId: string,
    kind: 'CRAFTING_PROJECT' | 'ALCHEMY_BREW',
    amount: number
) {
    const existing = await getCharacterRecord(ctx, recordId, kind);
    try {
        const result = advanceProgress(existing.data, amount);
        return updateCharacterRecord(ctx, {
            recordId,
            kind,
            data: result.data,
            status: result.completed ? 'COMPLETED' : existing.status,
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        return validationError(error);
    }
}

export async function setFactionStanding(
    ctx: Ctx,
    input: { guildId: string; targetDiscordId: string; factionId: string; standing: number; note?: string }
) {
    const guildId = requireDmGuild(ctx, input.guildId);
    if (!Number.isInteger(input.standing) || input.standing < -100 || input.standing > 100) {
        throw httpError(400, 'Faction standing must be an integer from -100 to 100');
    }
    const [faction] = await db
        .select()
        .from(campaignRecords)
        .where(
            and(
                eq(campaignRecords.guild_id, guildId),
                eq(campaignRecords.kind, 'FACTION'),
                eq(campaignRecords.id, input.factionId)
            )
        )
        .limit(1);
    if (!faction) throw httpError(404, 'Faction not found');
    const [membership] = await db
        .select({ playerId: partyMemberships.player_id })
        .from(partyMemberships)
        .where(and(eq(partyMemberships.guild_id, guildId), eq(partyMemberships.discord_id, input.targetDiscordId)))
        .limit(1);
    if (!membership) throw httpError(404, 'Target user has no character enrolled in this server party');
    const data = {
        factionId: faction.id,
        factionName: faction.name,
        standing: input.standing,
        note: normalizeText(input.note, 'note', 500),
        guildId,
    };
    const [record] = await db
        .insert(characterRecords)
        .values({
            player_id: membership.playerId,
            kind: 'REPUTATION',
            name: faction.name,
            data,
            created_by_discord_id: ctx.discordId,
        })
        .onConflictDoUpdate({
            target: [characterRecords.player_id, characterRecords.kind, characterRecords.name],
            set: { data, updated_at: new Date() },
        })
        .returning();
    return record;
}

export async function startAlchemyBrew(ctx: Ctx, input: { guildId: string; recipeId: string }) {
    const playerId = await selectedPlayerId(ctx);
    const guildId = input.guildId?.trim();
    if (!guildId) throw httpError(400, 'Alchemy can only be used in a Discord server');
    const [recipe] = await db
        .select()
        .from(campaignRecords)
        .where(
            and(
                eq(campaignRecords.guild_id, guildId),
                eq(campaignRecords.kind, 'ALCHEMY_RECIPE'),
                eq(campaignRecords.id, input.recipeId)
            )
        )
        .limit(1);
    if (!recipe) throw httpError(404, 'Alchemy recipe not found');
    const difficulty = Math.max(1, Math.min(100, Number(recipe.data.difficulty || 1)));
    const [record] = await db
        .insert(characterRecords)
        .values({
            player_id: playerId,
            kind: 'ALCHEMY_BREW',
            name: `${recipe.name} · ${new Date().toISOString().slice(0, 10)}`,
            data: {
                recipeId: recipe.id,
                recipeName: recipe.name,
                ingredients: recipe.data.ingredients || '',
                result: recipe.data.result || '',
                progress: 0,
                target: difficulty,
                guildId,
            },
            created_by_discord_id: ctx.discordId,
        })
        .returning();
    return record;
}

export async function listAlchemyRecipes(guildId: string) {
    const scopedGuildId = guildId?.trim();
    if (!scopedGuildId) throw httpError(400, 'Alchemy can only be used in a Discord server');
    return db
        .select()
        .from(campaignRecords)
        .where(and(eq(campaignRecords.guild_id, scopedGuildId), eq(campaignRecords.kind, 'ALCHEMY_RECIPE')))
        .orderBy(asc(campaignRecords.name))
        .limit(100);
}

export type MatchKind = 'exact' | 'normalized' | 'alias' | 'ambiguous' | 'unresolved';

export interface CatalogMatch<T> {
    inputName: string;
    kind: MatchKind;
    row: T | null;
}

const IMPORT_ALIASES: Record<string, string> = {
    koerperbeherrschung: 'körperbeherrschung',
    ueberreden: 'überreden',
    ueberzeugen: 'überzeugen',
    schloesserknacken: 'schlösserknacken',
};

function catalogKey(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

export function matchCatalog<T extends { name: string }>(names: string[], catalog: T[]): CatalogMatch<T>[] {
    return names.map(inputName => {
        const exact = catalog.filter(row => row.name === inputName);
        if (exact.length === 1) return { inputName, kind: 'exact', row: exact[0] };
        const key = catalogKey(inputName);
        const normalized = catalog.filter(row => catalogKey(row.name) === key);
        if (normalized.length === 1) return { inputName, kind: 'normalized', row: normalized[0] };
        if (normalized.length > 1) return { inputName, kind: 'ambiguous', row: null };
        const alias = IMPORT_ALIASES[key];
        if (alias) {
            const aliased = catalog.filter(row => catalogKey(row.name) === catalogKey(alias));
            if (aliased.length === 1) return { inputName, kind: 'alias', row: aliased[0] };
            if (aliased.length > 1) return { inputName, kind: 'ambiguous', row: null };
        }
        return { inputName, kind: 'unresolved', row: null };
    });
}

function summarize(matches: CatalogMatch<unknown>[]) {
    return matches.reduce<Record<MatchKind, number>>(
        (counts, match) => ({ ...counts, [match.kind]: counts[match.kind] + 1 }),
        { exact: 0, normalized: 0, alias: 0, ambiguous: 0, unresolved: 0 }
    );
}

async function reconciliation(parsed: CharacterImportResult) {
    const [talentCatalog, maneuverCatalog, specialCatalog, spellCatalog, liturgyCatalog] = await Promise.all([
        db.select({ id: talents.id, name: talents.name }).from(talents),
        db.select({ id: actionModifications.id, name: actionModifications.name }).from(actionModifications),
        db.select({ id: specialAbilities.id, name: specialAbilities.name }).from(specialAbilities),
        db.select({ id: spells.id, name: spells.name }).from(spells),
        db.select({ id: liturgies.id, name: liturgies.name }).from(liturgies),
    ]);
    const combatAbilities = (parsed.specialAbilities ?? []).filter(row => row.category === 'COMBAT');
    const nonCombatAbilities = (parsed.specialAbilities ?? []).filter(row => row.category !== 'COMBAT');
    return {
        talents: matchCatalog(
            (parsed.talents ?? []).map(row => row.name),
            talentCatalog
        ),
        maneuvers: matchCatalog(
            combatAbilities.map(row => row.name),
            maneuverCatalog
        ),
        specialAbilities: matchCatalog(
            nonCombatAbilities.map(row => row.name),
            specialCatalog
        ),
        spells: matchCatalog(
            (parsed.spells ?? []).map(row => row.name),
            spellCatalog
        ),
        liturgies: matchCatalog(
            (parsed.liturgies ?? []).map(row => row.name),
            liturgyCatalog
        ),
        combinedSpells: matchCatalog(
            (parsed.combinedSupernatural ?? []).map(row => row.name),
            spellCatalog
        ),
        combinedLiturgies: matchCatalog(
            (parsed.combinedSupernatural ?? []).map(row => row.name),
            liturgyCatalog
        ),
    };
}

export async function previewCharacterImport(parsed: CharacterImportResult) {
    const matches = await reconciliation(parsed);
    return {
        parsed,
        proposedName: parsed.name,
        source: parsed.source,
        profileId: parsed.profileId ?? null,
        mappedCounts: {
            stats: Object.keys(parsed.stats).length,
            talents: parsed.talents?.length ?? 0,
            combatTechniques: parsed.combatTechniques?.length ?? 0,
            weapons: parsed.weapons?.length ?? 0,
            armor: parsed.armor?.length ?? 0,
            zonedArmor: parsed.zonedArmor?.length ?? 0,
            specialAbilities: parsed.specialAbilities?.length ?? 0,
            spells: parsed.spells?.length ?? 0,
            liturgies: parsed.liturgies?.length ?? 0,
            advantages: parsed.advantages?.length ?? 0,
            disadvantages: parsed.disadvantages?.length ?? 0,
        },
        catalogMatches: {
            talents: summarize(matches.talents),
            maneuvers: summarize(matches.maneuvers),
            specialAbilities: summarize(matches.specialAbilities),
            spells: summarize(matches.spells),
            liturgies: summarize(matches.liturgies),
            combinedSpells: summarize(matches.combinedSpells),
            combinedLiturgies: summarize(matches.combinedLiturgies),
        },
        unresolvedFieldCount: parsed.unresolvedFieldCount ?? parsed.unresolvedFields?.length ?? 0,
        unresolvedFields: parsed.unresolvedFields ?? [],
        warnings: parsed.warnings ?? [],
    };
}

export async function importNormalizedCharacter(ctx: Ctx, parsed: CharacterImportResult, guildId?: string) {
    const matches = await reconciliation(parsed);
    const result = await db.transaction(async tx => {
        const [player] = await tx
            .insert(players)
            .values({ name: parsed.name, discord_id: ctx.discordId, selected: 'NO' })
            .returning();
        if (!player) throw httpError(500, 'Failed to create imported character');
        const [statsRow] = await tx
            .insert(stats)
            .values({ player_id: player.id, ...parsed.stats })
            .returning();
        await tx.insert(wallets).values({ player_id: player.id });

        const allTalents = await tx.select({ id: talents.id }).from(talents);
        if (allTalents.length) {
            await tx
                .insert(playerTalents)
                .values(allTalents.map(row => ({ player_id: player.id, talent_id: row.id, ftw: 0 })));
        }
        for (const match of matches.talents) {
            if (!match.row) continue;
            const imported = parsed.talents?.find(row => row.name === match.inputName);
            await tx
                .update(playerTalents)
                .set({ ftw: imported?.value ?? 0 })
                .where(and(eq(playerTalents.player_id, player.id), eq(playerTalents.talent_id, match.row.id)));
        }

        if (parsed.background) {
            await tx.insert(characterRecords).values({
                player_id: player.id,
                kind: 'BACKGROUND',
                name: 'Profile',
                data: { ...parsed.background, importSource: parsed.source, profileId: parsed.profileId ?? null },
                created_by_discord_id: ctx.discordId,
            });
        }
        for (const technique of parsed.combatTechniques ?? []) {
            await tx.insert(characterRecords).values({
                player_id: player.id,
                kind: 'COMBAT_TECHNIQUE',
                name: technique.name,
                data: { value: technique.value, at: technique.at ?? 0, pa: technique.pa ?? 0 },
                created_by_discord_id: ctx.discordId,
            });
        }

        let offenseEquipped = false;
        let defenseEquipped = false;
        for (const imported of parsed.weapons ?? []) {
            const isShield = (imported.shieldPaBonus ?? 0) > 0;
            const requestedEquip = imported.isEquipped ?? true;
            const shouldEquip = requestedEquip && (isShield ? !defenseEquipped : !offenseEquipped);
            if (isShield && shouldEquip) defenseEquipped = true;
            else if (shouldEquip) offenseEquipped = true;
            await tx.insert(weapons).values({
                player_id: player.id,
                name: imported.name,
                type: imported.type,
                combat_technique: imported.combatTechnique,
                tp: imported.tp ?? '1w6',
                at: imported.at ?? 0,
                pa: imported.pa ?? 0,
                range_close: imported.rangeClose,
                range_medium: imported.rangeMedium,
                range_far: imported.rangeFar,
                reload_actions: imported.reloadActions ?? 0,
                is_two_handed: imported.isTwoHanded ?? false,
                shield_pa_bonus: imported.shieldPaBonus ?? 0,
                weight_grams: imported.weightGrams ?? 0,
                is_equipped: shouldEquip ? 'Y' : 'N',
                equipped_slot: shouldEquip ? (isShield ? 'DEFENSE' : 'OFFENSE') : null,
            });
        }
        for (const [index, imported] of (parsed.armor ?? []).entries()) {
            const shouldEquip = imported.isEquipped ?? index === 0;
            await tx.insert(items).values({
                player_id: player.id,
                name: imported.name,
                type: 'ARMOR',
                description: imported.area ? `Coverage: ${imported.area}` : undefined,
                weight_grams: imported.weightGrams ?? 0,
                armor_rs: imported.armorRs,
                armor_be: imported.armorBe,
                is_equipped: shouldEquip,
                equipped_slot: shouldEquip ? 'ARMOR' : null,
            });
        }

        for (const match of matches.maneuvers) {
            if (!match.row) continue;
            await tx.insert(playerActionModifications).values({
                player_id: player.id,
                action_modification_id: match.row.id,
                ftw: 0,
            });
        }
        for (const match of matches.specialAbilities) {
            if (!match.row) continue;
            await tx.insert(playerSpecialAbilities).values({
                player_id: player.id,
                special_ability_id: match.row.id,
            });
        }
        for (const match of matches.spells) {
            if (!match.row) continue;
            const imported = parsed.spells?.find(row => row.name === match.inputName);
            await tx
                .insert(playerSpells)
                .values({ player_id: player.id, spell_id: match.row.id, ftw: imported?.value ?? 0 })
                .onConflictDoUpdate({
                    target: [playerSpells.player_id, playerSpells.spell_id],
                    set: { ftw: imported?.value ?? 0, updated_at: new Date() },
                });
        }
        for (const match of matches.liturgies) {
            if (!match.row) continue;
            const imported = parsed.liturgies?.find(row => row.name === match.inputName);
            await tx
                .insert(playerLiturgies)
                .values({ player_id: player.id, liturgy_id: match.row.id, ftw: imported?.value ?? 0 })
                .onConflictDoUpdate({
                    target: [playerLiturgies.player_id, playerLiturgies.liturgy_id],
                    set: { ftw: imported?.value ?? 0, updated_at: new Date() },
                });
        }
        for (const imported of parsed.combinedSupernatural ?? []) {
            const spellMatch = matches.combinedSpells.find(match => match.inputName === imported.name);
            const liturgyMatch = matches.combinedLiturgies.find(match => match.inputName === imported.name);
            if (spellMatch?.row && !liturgyMatch?.row) {
                await tx
                    .insert(playerSpells)
                    .values({ player_id: player.id, spell_id: spellMatch.row.id, ftw: imported.value })
                    .onConflictDoUpdate({
                        target: [playerSpells.player_id, playerSpells.spell_id],
                        set: { ftw: imported.value, updated_at: new Date() },
                    });
            } else if (liturgyMatch?.row && !spellMatch?.row) {
                await tx
                    .insert(playerLiturgies)
                    .values({ player_id: player.id, liturgy_id: liturgyMatch.row.id, ftw: imported.value })
                    .onConflictDoUpdate({
                        target: [playerLiturgies.player_id, playerLiturgies.liturgy_id],
                        set: { ftw: imported.value, updated_at: new Date() },
                    });
            }
        }

        const recordList = [
            ...(parsed.advantages ?? []).map(name => ({ kind: 'ADVANTAGE', name, data: {} })),
            ...(parsed.disadvantages ?? []).map(name => ({ kind: 'DISADVANTAGE', name, data: {} })),
            ...(parsed.specialAbilities ?? [])
                .filter(row => row.category === 'GENERAL')
                .map(row => ({ kind: 'SPECIAL_ABILITY', name: row.name, data: { category: row.category } })),
            ...(parsed.zonedArmor ?? []).map(row => ({ kind: 'ZONED_ARMOR', name: row.name, data: row.zones })),
        ];
        for (const record of recordList) {
            await tx.insert(characterRecords).values({
                player_id: player.id,
                ...record,
                created_by_discord_id: ctx.discordId,
            });
        }
        const unresolvedCombined = (parsed.combinedSupernatural ?? [])
            .map(imported => {
                const spellMatch = matches.combinedSpells.find(match => match.inputName === imported.name);
                const liturgyMatch = matches.combinedLiturgies.find(match => match.inputName === imported.name);
                const resolvedKinds = Number(Boolean(spellMatch?.row)) + Number(Boolean(liturgyMatch?.row));
                if (resolvedKinds === 1) return null;
                const kind: MatchKind =
                    resolvedKinds > 1 || spellMatch?.kind === 'ambiguous' || liturgyMatch?.kind === 'ambiguous'
                        ? 'ambiguous'
                        : 'unresolved';
                return { inputName: imported.name, kind, row: null } satisfies CatalogMatch<never>;
            })
            .filter(
                (match): match is { inputName: string; kind: 'ambiguous' | 'unresolved'; row: null } => match !== null
            );
        const unresolvedCatalog = [
            ...matches.talents,
            ...matches.maneuvers,
            ...matches.specialAbilities,
            ...matches.spells,
            ...matches.liturgies,
            ...unresolvedCombined,
        ].filter(match => !match.row);
        if ((parsed.unresolvedFieldCount ?? 0) > 0 || unresolvedCatalog.length > 0) {
            await tx.insert(characterRecords).values({
                player_id: player.id,
                kind: 'IMPORT_UNRESOLVED',
                name: `Import ${new Date().toISOString()}`,
                data: {
                    profileId: parsed.profileId ?? null,
                    fieldCount: parsed.unresolvedFieldCount ?? parsed.unresolvedFields?.length ?? 0,
                    fields: parsed.unresolvedFields ?? [],
                    catalog: unresolvedCatalog.map(match => ({ name: match.inputName, status: match.kind })),
                },
                created_by_discord_id: ctx.discordId,
            });
        }
        return { player, stats: statsRow };
    });

    if (guildId) {
        try {
            const { dispatchWebhookEvent } = await import('./webhooks');
            await dispatchWebhookEvent(guildId, 'character.imported', {
                characterId: result.player.id,
                name: result.player.name,
                source: parsed.source,
            });
        } catch {
            // Import success is independent of optional integration delivery.
        }
    }
    return { ...result, source: parsed.source, preview: await previewCharacterImport(parsed) };
}

export async function importCharacter(ctx: Ctx, raw: unknown, guildId?: string) {
    let parsed: CharacterImportResult;
    try {
        parsed = parseCharacterImport(raw);
    } catch (error) {
        return validationError(error);
    }
    return importNormalizedCharacter(ctx, parsed, guildId);
}

export async function getLatestImportReport(ctx: Ctx) {
    const playerId = await selectedPlayerId(ctx);
    const [report] = await db
        .select()
        .from(characterRecords)
        .where(and(eq(characterRecords.player_id, playerId), eq(characterRecords.kind, 'IMPORT_UNRESOLVED')))
        .orderBy(desc(characterRecords.created_at))
        .limit(1);
    if (!report) throw httpError(404, 'The selected character has no unresolved import report');
    return report;
}
