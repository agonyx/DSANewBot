import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { sessionNotes } from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    MAX_SESSION_NOTES_PER_GUILD,
    normalizeSessionDate,
    normalizeSessionNoteBody,
    normalizeSessionNoteTitle,
} from '../utils/sessionNoteUtils';
import type { Ctx } from './_ctx';
import { requireDmGuild } from './guildAuth';

function requireDmScope(ctx: Ctx, guildId: string) {
    return requireDmGuild(ctx, guildId);
}

function validationError(error: unknown): never {
    if (error instanceof Error) throw httpError(400, error.message);
    throw httpError(400, 'Invalid session note');
}

export async function createSessionNote(
    ctx: Ctx,
    input: { guildId: string; title: string; body: string; sessionDate?: string }
) {
    const guildId = requireDmScope(ctx, input.guildId);
    let title: string;
    let body: string;
    let sessionDate: string | null;
    try {
        title = normalizeSessionNoteTitle(input.title);
        body = normalizeSessionNoteBody(input.body);
        sessionDate = normalizeSessionDate(input.sessionDate);
    } catch (error) {
        return validationError(error);
    }
    const current = await db
        .select({ id: sessionNotes.id })
        .from(sessionNotes)
        .where(eq(sessionNotes.guild_id, guildId))
        .limit(MAX_SESSION_NOTES_PER_GUILD);
    if (current.length >= MAX_SESSION_NOTES_PER_GUILD) {
        throw httpError(409, `A server can save at most ${MAX_SESSION_NOTES_PER_GUILD} session notes`);
    }
    const [note] = await db
        .insert(sessionNotes)
        .values({
            guild_id: guildId,
            title,
            body,
            session_date: sessionDate,
            created_by_discord_id: ctx.discordId,
            updated_by_discord_id: ctx.discordId,
        })
        .returning();
    return note;
}

export async function listSessionNotes(ctx: Ctx, guildId: string) {
    const scopedGuildId = requireDmScope(ctx, guildId);
    return db
        .select()
        .from(sessionNotes)
        .where(eq(sessionNotes.guild_id, scopedGuildId))
        .orderBy(desc(sessionNotes.created_at))
        .limit(MAX_SESSION_NOTES_PER_GUILD);
}

export async function getSessionNote(ctx: Ctx, guildId: string, noteId: string) {
    const scopedGuildId = requireDmScope(ctx, guildId);
    const [note] = await db
        .select()
        .from(sessionNotes)
        .where(and(eq(sessionNotes.guild_id, scopedGuildId), eq(sessionNotes.id, noteId)))
        .limit(1);
    if (!note) throw httpError(404, 'Session note not found');
    return note;
}

export async function updateSessionNote(
    ctx: Ctx,
    input: { guildId: string; noteId: string; title?: string; body?: string; sessionDate?: string }
) {
    const existing = await getSessionNote(ctx, input.guildId, input.noteId);
    if (input.title === undefined && input.body === undefined && input.sessionDate === undefined) {
        throw httpError(400, 'Provide a title, content, or date to update');
    }
    let change: { title?: string; body?: string; session_date?: string | null };
    try {
        change = {
            ...(input.title === undefined ? {} : { title: normalizeSessionNoteTitle(input.title) }),
            ...(input.body === undefined ? {} : { body: normalizeSessionNoteBody(input.body) }),
            ...(input.sessionDate === undefined ? {} : { session_date: normalizeSessionDate(input.sessionDate) }),
        };
    } catch (error) {
        return validationError(error);
    }
    const [updated] = await db
        .update(sessionNotes)
        .set({ ...change, updated_by_discord_id: ctx.discordId, updated_at: new Date() })
        .where(and(eq(sessionNotes.id, existing.id), eq(sessionNotes.updated_at, existing.updated_at)))
        .returning();
    if (!updated) throw httpError(409, 'The session note changed; retry the command');
    return updated;
}

export async function deleteSessionNote(ctx: Ctx, guildId: string, noteId: string) {
    const existing = await getSessionNote(ctx, guildId, noteId);
    const [deleted] = await db.delete(sessionNotes).where(eq(sessionNotes.id, existing.id)).returning();
    return deleted;
}
