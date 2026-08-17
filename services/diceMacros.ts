import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { diceMacros } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { MAX_DICE_MACROS_PER_CHARACTER, normalizeDiceMacroName } from '../utils/diceMacroUtils';
import { normalizeDiceNotation } from '../utils/diceUtils';
import { getSelectedPlayer } from './characters';
import type { Ctx } from './_ctx';

function normalizeInput(input: { name: string; notation?: string }) {
    try {
        return {
            name: normalizeDiceMacroName(input.name),
            notation: input.notation === undefined ? undefined : normalizeDiceNotation(input.notation),
        };
    } catch (error) {
        throw httpError(400, error instanceof Error ? error.message : 'Invalid dice macro');
    }
}

export async function listDiceMacros(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    return db
        .select()
        .from(diceMacros)
        .where(eq(diceMacros.player_id, player.id))
        .orderBy(diceMacros.name)
        .limit(MAX_DICE_MACROS_PER_CHARACTER);
}

export async function saveDiceMacro(ctx: Ctx, input: { name: string; notation: string }) {
    const player = await getSelectedPlayer(ctx);
    const normalized = normalizeInput(input);
    const [existing] = await db
        .select({ id: diceMacros.id })
        .from(diceMacros)
        .where(and(eq(diceMacros.player_id, player.id), eq(diceMacros.name, normalized.name)))
        .limit(1);
    if (!existing) {
        const current = await db
            .select({ id: diceMacros.id })
            .from(diceMacros)
            .where(eq(diceMacros.player_id, player.id))
            .limit(MAX_DICE_MACROS_PER_CHARACTER);
        if (current.length >= MAX_DICE_MACROS_PER_CHARACTER) {
            throw httpError(409, `A character can save at most ${MAX_DICE_MACROS_PER_CHARACTER} dice macros`);
        }
    }
    const [macro] = await db
        .insert(diceMacros)
        .values({ player_id: player.id, name: normalized.name, notation: normalized.notation! })
        .onConflictDoUpdate({
            target: [diceMacros.player_id, diceMacros.name],
            set: { notation: normalized.notation!, updated_at: new Date() },
        })
        .returning();
    return { characterName: player.name, macro, created: !existing };
}

export async function getDiceMacro(ctx: Ctx, name: string) {
    const player = await getSelectedPlayer(ctx);
    const normalized = normalizeInput({ name });
    const [macro] = await db
        .select()
        .from(diceMacros)
        .where(and(eq(diceMacros.player_id, player.id), eq(diceMacros.name, normalized.name)))
        .limit(1);
    if (!macro) throw httpError(404, `Dice macro '${normalized.name}' not found`);
    return { characterName: player.name, macro };
}

export async function deleteDiceMacro(ctx: Ctx, name: string) {
    const player = await getSelectedPlayer(ctx);
    const normalized = normalizeInput({ name });
    const [deleted] = await db
        .delete(diceMacros)
        .where(and(eq(diceMacros.player_id, player.id), eq(diceMacros.name, normalized.name)))
        .returning();
    if (!deleted) throw httpError(404, `Dice macro '${normalized.name}' not found`);
    return { characterName: player.name, macro: deleted };
}
