/**
 * In-process ports of the player Edge Functions
 * (DSABackend/supabase/functions/create-player, delete-player, set-selected-player).
 * Manual rollback is replaced by real db.transaction() atomicity.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { players, stats, talents, playerTalents, wallets } from '../schema';
import { httpError } from './errors';

export interface CreatedPlayer {
    player: typeof players.$inferSelect;
    stats: typeof stats.$inferSelect;
}

/** Create a player, their stats row, and a player_talents entry (ftw=0) for every talent. */
export async function createPlayer(input: { name: string; discordId: string }): Promise<CreatedPlayer> {
    const { name, discordId } = input;
    if (!name || !discordId) throw httpError(400, 'name and discordId are required');

    return db.transaction(async tx => {
        const [player] = await tx.insert(players).values({ name, discord_id: discordId, selected: 'NO' }).returning();
        if (!player) throw httpError(500, 'Failed to create player');

        const [statsRow] = await tx.insert(stats).values({ player_id: player.id }).returning();
        if (!statsRow) throw httpError(500, 'Failed to create stats');
        await tx.insert(wallets).values({ player_id: player.id });

        const allTalents = await tx.select({ id: talents.id }).from(talents);
        if (allTalents.length > 0) {
            await tx
                .insert(playerTalents)
                .values(allTalents.map(t => ({ player_id: player.id, talent_id: t.id, ftw: 0 })));
        }

        return { player, stats: statsRow };
    });
}

/** Delete a player; CASCADE removes stats, talents, weapons, items, etc. */
export async function deletePlayer(playerId: number): Promise<{ success: true; message: string }> {
    if (!playerId) throw httpError(400, 'Player ID is required');

    const [existing] = await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(eq(players.id, playerId));
    if (!existing) throw httpError(404, 'Player not found');

    await db.delete(players).where(eq(players.id, playerId));
    return { success: true, message: `Player '${existing.name}' deleted successfully` };
}

/** Set the active (selected) character for a Discord user, deselecting the previous one. */
export async function setSelectedPlayer(input: { playerId: number; discordId: string }): Promise<{ message: string }> {
    const { playerId, discordId } = input;
    if (!playerId || !discordId) throw httpError(400, 'playerId and discordId are required');

    return db.transaction(async tx => {
        const [previous] = await tx
            .select({ id: players.id })
            .from(players)
            .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')));
        if (previous) {
            await tx.update(players).set({ selected: 'NO' }).where(eq(players.id, previous.id));
        }

        const [player] = await tx
            .select({ id: players.id, discord_id: players.discord_id })
            .from(players)
            .where(eq(players.id, playerId));
        if (!player) throw httpError(404, 'Player not found');
        if (player.discord_id !== discordId) {
            throw httpError(403, 'Player does not belong to this Discord user');
        }

        await tx.update(players).set({ selected: 'YES' }).where(eq(players.id, playerId));
        return { message: 'Selected player updated successfully' };
    });
}
