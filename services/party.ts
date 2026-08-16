import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { partyMemberships, players, stats } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { getSelectedPlayer } from './characters';
import type { Ctx } from './_ctx';

function requireGuildId(guildId: string) {
    const normalized = guildId?.trim();
    if (!normalized) throw httpError(400, 'This command can only be used in a Discord server');
    return normalized;
}

function requireDm(ctx: Ctx) {
    if (ctx.role !== 'DM') throw httpError(403, 'Party overview requires DM authorization');
}

/** Opt the caller's selected character into this guild's party. */
export async function joinParty(ctx: Ctx, guildId: string) {
    const normalizedGuildId = requireGuildId(guildId);
    const player = await getSelectedPlayer(ctx);
    const [membership] = await db
        .insert(partyMemberships)
        .values({ guild_id: normalizedGuildId, discord_id: ctx.discordId, player_id: player.id })
        .onConflictDoUpdate({
            target: [partyMemberships.guild_id, partyMemberships.discord_id],
            set: { player_id: player.id, updated_at: new Date() },
        })
        .returning();
    return { membership, characterName: player.name };
}

/** Remove the caller's party membership from this guild. */
export async function leaveParty(ctx: Ctx, guildId: string) {
    const normalizedGuildId = requireGuildId(guildId);
    const [membership] = await db
        .delete(partyMemberships)
        .where(and(eq(partyMemberships.guild_id, normalizedGuildId), eq(partyMemberships.discord_id, ctx.discordId)))
        .returning();
    if (!membership) throw httpError(404, 'You have not joined this server party');
    return { membership };
}

/** Return only characters explicitly enrolled in this guild. */
export async function listParty(ctx: Ctx, guildId: string) {
    requireDm(ctx);
    const normalizedGuildId = requireGuildId(guildId);
    return db
        .select({
            membershipId: partyMemberships.id,
            discordId: partyMemberships.discord_id,
            playerId: players.id,
            name: players.name,
            avatar: players.avatar,
            initiative: stats.initiative,
            leCurrent: stats.le_current,
            leMax: stats.le_max,
            wounds: stats.wounds,
            aspCurrent: stats.asp_current,
            aspMax: stats.asp_max,
            kapCurrent: stats.kap_current,
            kapMax: stats.kap_max,
            fateCurrent: stats.schicksalspunkte_current,
            fateMax: stats.schicksalspunkte_max,
        })
        .from(partyMemberships)
        .innerJoin(players, eq(players.id, partyMemberships.player_id))
        .leftJoin(stats, eq(stats.player_id, players.id))
        .where(eq(partyMemberships.guild_id, normalizedGuildId))
        .orderBy(asc(players.name));
}
