/**
 * Character services — pure business logic over Drizzle. ctx-authenticated
 * (Discord command or website JWT). Throw HttpError on business failures.
 */
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { players, stats } from '../db/schema';
import { createPlayer, deletePlayer, setSelectedPlayer } from '../db/operations';
import { httpError } from '../db/operations/errors';
import type { Ctx } from './_ctx';

/** Columns a caller is allowed to set via updateStat. */
const ALLOWED_STATS = new Set([
    'mu',
    'kl',
    'in',
    'ch',
    'ff',
    'ge',
    'ko',
    'kk',
    'le_max',
    'le_current',
    'asp_max',
    'asp_current',
    'wounds',
    'wound_threshold_modifier',
    'kap_max',
    'kap_current',
    'schicksalspunkte_max',
    'schicksalspunkte_current',
    'initiative',
    'ruestungsschutz',
    'natural_armor',
    'ausweichen',
    'attacke_basis',
    'parade_basis',
]);

/** Create a new character for the caller (keys stats + player_talents off ctx.discordId). */
export async function createCharacter(ctx: Ctx, input: { name: string }) {
    if (!input.name?.trim()) throw httpError(400, 'name is required');
    return createPlayer({ name: input.name.trim(), discordId: ctx.discordId });
}

/** List all characters belonging to the caller. */
export async function listCharacters(ctx: Ctx) {
    return db.select().from(players).where(eq(players.discord_id, ctx.discordId));
}

/** The caller's currently-selected character (throws 404 if none). */
export async function getSelectedPlayer(ctx: Ctx) {
    const [player] = await db
        .select()
        .from(players)
        .where(and(eq(players.discord_id, ctx.discordId), eq(players.selected, 'YES')))
        .limit(1);
    if (!player) throw httpError(404, 'No selected character. Use /choose-character first.');
    return player;
}

/** The caller's currently-selected character + its stats (the character sheet). */
export async function getCharacterSheet(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    const [statsRow] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
    return { player, stats: statsRow ?? null };
}

/** Select (activate) one of the caller's characters by id. */
export async function selectCharacter(ctx: Ctx, playerId: number) {
    return setSelectedPlayer({ playerId, discordId: ctx.discordId });
}

/** Set a single stat on the caller's selected character (DM/owner override). */
export async function updateStat(ctx: Ctx, input: { statKey: string; value: number }) {
    if (!ALLOWED_STATS.has(input.statKey)) {
        throw httpError(400, `Invalid stat key: ${input.statKey}`);
    }
    if (!Number.isInteger(input.value)) throw httpError(400, 'Stat value must be an integer');
    if (input.statKey === 'wounds' && input.value < 0) {
        throw httpError(400, 'Wounds cannot be negative');
    }
    if (['ruestungsschutz', 'natural_armor'].includes(input.statKey) && input.value < 0) {
        throw httpError(400, 'Natural armor cannot be negative');
    }
    const { player } = await getCharacterSheet(ctx); // ensures ownership + selected
    const persistedKey = input.statKey === 'ruestungsschutz' ? 'natural_armor' : input.statKey;
    await db
        .update(stats)
        .set({ [persistedKey]: input.value })
        .where(eq(stats.player_id, player.id));
    if (persistedKey === 'natural_armor' || persistedKey === 'kk') {
        const { synchronizeEquipmentDerivedStatsForPlayer } = await import('./equipment');
        await synchronizeEquipmentDerivedStatsForPlayer(player.id);
    }
    const [updated] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
    return { statKey: input.statKey, value: updated?.[input.statKey as keyof typeof updated] ?? input.value };
}

/** Delete a character owned by the caller (CASCADE removes stats, talents, weapons, items). */
export async function deleteCharacter(ctx: Ctx, playerId: number) {
    const [player] = await db
        .select({ id: players.id, discord_id: players.discord_id })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);
    if (!player) throw httpError(404, 'Character not found');
    if (player.discord_id !== ctx.discordId) throw httpError(403, 'Not your character');
    return deletePlayer(playerId);
}
