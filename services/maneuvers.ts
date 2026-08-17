/** Read-only combat maneuver catalog shared by Discord, API, and advancement. */
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { actionModifications } from '../db/schema';
import { httpError } from '../db/operations/errors';
import type { Ctx } from './_ctx';

export async function listManeuvers(_ctx: Ctx, actionType?: 'MELEE' | 'RANGED' | 'MAGIC') {
    const query = db.select().from(actionModifications);
    return actionType
        ? query.where(eq(actionModifications.action_type, actionType)).orderBy(asc(actionModifications.name))
        : query.orderBy(asc(actionModifications.name));
}

export async function getManeuver(_ctx: Ctx, maneuverId: string) {
    const [maneuver] = await db
        .select()
        .from(actionModifications)
        .where(eq(actionModifications.id, maneuverId))
        .limit(1);
    if (!maneuver) throw httpError(404, 'Combat maneuver not found');
    return maneuver;
}
