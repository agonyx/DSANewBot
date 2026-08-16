import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { initiativeTrackers } from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    addEntryToTracker,
    advanceInitiativeTracker,
    createPartyInitiativeEntries,
    normalizeInitiativeName,
    removeEntryFromTracker,
} from '../utils/initiativeTracker';
import type { Ctx } from './_ctx';
import { listParty } from './party';

function requireDm(ctx: Ctx) {
    if (ctx.role !== 'DM') throw httpError(403, 'Initiative tracker management requires DM authorization');
}

function scope(ctx: Ctx, guildId: string, channelId: string) {
    requireDm(ctx);
    if (!guildId?.trim() || !channelId?.trim()) {
        throw httpError(400, 'Initiative trackers require a Discord server and channel');
    }
    return and(eq(initiativeTrackers.guild_id, guildId.trim()), eq(initiativeTrackers.channel_id, channelId.trim()));
}

function asHttpError(error: unknown): never {
    if (error instanceof Error) throw httpError(400, error.message);
    throw httpError(400, 'Invalid initiative tracker change');
}

async function persistTrackerChange(
    tracker: typeof initiativeTrackers.$inferSelect,
    change: Partial<typeof initiativeTrackers.$inferInsert>
) {
    const [updated] = await db
        .update(initiativeTrackers)
        .set({ ...change, updated_at: new Date() })
        .where(and(eq(initiativeTrackers.id, tracker.id), eq(initiativeTrackers.updated_at, tracker.updated_at)))
        .returning();
    if (!updated) throw httpError(409, 'The initiative tracker changed; retry the command');
    return updated;
}

export async function getInitiativeTracker(ctx: Ctx, guildId: string, channelId: string) {
    const [tracker] = await db
        .select()
        .from(initiativeTrackers)
        .where(scope(ctx, guildId, channelId))
        .limit(1);
    if (!tracker) throw httpError(404, 'No initiative tracker is active in this channel');
    return tracker;
}

export async function startInitiativeTracker(ctx: Ctx, input: { guildId: string; channelId: string; title?: string }) {
    scope(ctx, input.guildId, input.channelId);
    const party = await listParty(ctx, input.guildId);
    let title: string;
    let entries;
    try {
        title = normalizeInitiativeName(input.title, 'Initiative');
        entries = createPartyInitiativeEntries(party);
    } catch (error) {
        return asHttpError(error);
    }

    const [tracker] = await db
        .insert(initiativeTrackers)
        .values({
            guild_id: input.guildId,
            channel_id: input.channelId,
            title,
            entries,
            created_by_discord_id: ctx.discordId,
        })
        .onConflictDoNothing()
        .returning();
    if (!tracker) throw httpError(409, 'An initiative tracker is already active in this channel');
    return tracker;
}

export async function addInitiativeEntry(
    ctx: Ctx,
    input: { guildId: string; channelId: string; name: string; initiative: number }
) {
    const tracker = await getInitiativeTracker(ctx, input.guildId, input.channelId);
    let change;
    try {
        change = addEntryToTracker(tracker, input);
    } catch (error) {
        return asHttpError(error);
    }
    return persistTrackerChange(tracker, change);
}

export async function removeInitiativeEntry(ctx: Ctx, input: { guildId: string; channelId: string; entryId: string }) {
    const tracker = await getInitiativeTracker(ctx, input.guildId, input.channelId);
    let change;
    try {
        change = removeEntryFromTracker(tracker, input.entryId);
    } catch (error) {
        return asHttpError(error);
    }
    return persistTrackerChange(tracker, change);
}

export async function advanceInitiative(ctx: Ctx, guildId: string, channelId: string) {
    const tracker = await getInitiativeTracker(ctx, guildId, channelId);
    let change;
    try {
        change = advanceInitiativeTracker(tracker);
    } catch (error) {
        return asHttpError(error);
    }
    return persistTrackerChange(tracker, change);
}

export async function endInitiativeTracker(ctx: Ctx, guildId: string, channelId: string) {
    const [deleted] = await db
        .delete(initiativeTrackers)
        .where(scope(ctx, guildId, channelId))
        .returning();
    if (!deleted) throw httpError(404, 'No initiative tracker is active in this channel');
    return deleted;
}
