/**
 * Mob template services — CRUD over the global `mobs` definition table (reusable
 * combatant templates, DM-managed). ctx is kept for signature uniformity; mobs
 * are not player-scoped. Throws HttpError on business failures. No discord.js.
 */
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { mobs } from '../db/schema';
import { httpError } from '../db/operations/errors';
import type { Ctx } from './_ctx';

const DAMAGE_TP_RE = /^\d+w\d+(\s*\+\s*\d+)?$/i;

/** Columns a caller may set/patch on a mob template. */
const EDITABLE = new Set([
    'name',
    'description',
    'base_max_hp',
    'base_initiative',
    'base_attack_value',
    'base_parry_value',
    'base_armor_soak',
    'base_damage_tp',
]);

export interface CreateMobInput {
    name: string;
    base_max_hp: number;
    base_initiative: number;
    base_attack_value: number;
    base_parry_value: number;
    base_armor_soak: number;
    base_damage_tp: string;
    description?: string | null;
}

export async function createMob(_ctx: Ctx, input: CreateMobInput) {
    const name = input.name?.trim();
    if (!name) throw httpError(400, 'name is required');
    if (!DAMAGE_TP_RE.test(input.base_damage_tp)) {
        throw httpError(400, 'Invalid damage format (e.g. 1w6+2)');
    }

    const [existing] = await db.select({ id: mobs.id }).from(mobs).where(eq(mobs.name, name)).limit(1);
    if (existing) throw httpError(409, `A mob template named "${name}" already exists`);

    const [mob] = await db
        .insert(mobs)
        .values({
            name,
            base_max_hp: input.base_max_hp,
            base_initiative: input.base_initiative,
            base_attack_value: input.base_attack_value,
            base_parry_value: input.base_parry_value,
            base_armor_soak: input.base_armor_soak,
            base_damage_tp: input.base_damage_tp,
            description: input.description ?? null,
        })
        .returning();
    return mob;
}

export async function listMobs(_ctx: Ctx) {
    return db.select().from(mobs).orderBy(mobs.name);
}

export async function getMob(_ctx: Ctx, name: string) {
    const [mob] = await db.select().from(mobs).where(eq(mobs.name, name)).limit(1);
    if (!mob) throw httpError(404, `Mob template "${name}" not found`);
    return mob;
}

export async function getMobById(_ctx: Ctx, id: number) {
    const [mob] = await db.select().from(mobs).where(eq(mobs.id, id)).limit(1);
    if (!mob) throw httpError(404, 'Mob template not found');
    return mob;
}

export async function updateMob(_ctx: Ctx, input: { id: number; patch: Record<string, unknown> }) {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.patch)) {
        if (!EDITABLE.has(key)) continue; // silently drop unknown columns
        if (key === 'base_damage_tp' && typeof value === 'string' && !DAMAGE_TP_RE.test(value)) {
            throw httpError(400, 'Invalid damage format (e.g. 1w6+2)');
        }
        patch[key] = value;
    }
    // A patch containing no editable fields leaves the existing template unchanged.
    if (Object.keys(patch).length === 0) {
        return getMobById(_ctx, input.id);
    }
    const [updated] = await db.update(mobs).set(patch).where(eq(mobs.id, input.id)).returning();
    if (!updated) throw httpError(404, 'Mob template not found');
    return updated;
}

export async function deleteMob(_ctx: Ctx, id: number) {
    const [deleted] = await db.delete(mobs).where(eq(mobs.id, id)).returning({ id: mobs.id });
    if (!deleted) throw httpError(404, 'Mob template not found');
    return { deleted: true };
}
