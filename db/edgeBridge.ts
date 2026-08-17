/**
 * callEdgeFunction bridge — preserves the old Supabase Edge Function call contract
 * (`callEdgeFunction(name, payload)` → `{ data, status }`, throws with `.status` on
 * failure) while routing to the in-process Drizzle operations. Lets the ~6 existing
 * call sites stay unchanged; the rewire focuses on the `.from()` CRUD sites.
 *
 * New code should call the operations directly from db/operations.
 */

import {
    createPlayer,
    deletePlayer,
    setSelectedPlayer,
    createCombatant,
    startCombat,
    endCombat,
    updateCombatTurn,
    equipWeapon,
} from './operations';
import { HttpError } from './operations/errors';

type AnyObj = Record<string, unknown>;

export async function callEdgeFunction(
    name: string,
    payload: AnyObj,
    _method = 'POST'
): Promise<{ data: unknown; status: number }> {
    try {
        switch (name) {
            case 'create-player':
                return { data: await createPlayer(payload as any), status: 201 };
            case 'delete-player': {
                const id = (payload as any).id ?? (payload as any).playerId ?? payload;
                return { data: await deletePlayer(id), status: 200 };
            }
            case 'set-selected-player':
                return { data: await setSelectedPlayer(payload as any), status: 200 };
            case 'create-combatant':
                return { data: await createCombatant(payload as any), status: 201 };
            case 'start-combat':
                return { data: await startCombat(payload as any), status: 200 };
            case 'end-combat':
                return { data: await endCombat(payload as any), status: 200 };
            case 'update-combat-turn':
                return { data: await updateCombatTurn(payload as any), status: 200 };
            case 'equip-weapon':
                return { data: await equipWeapon(payload as any), status: 200 };
            default:
                throw new HttpError(404, `Unknown edge function: ${name}`);
        }
    } catch (err) {
        const e = err as Partial<HttpError> & { message?: string };
        const error: Error & { status?: number; data?: unknown } = new Error(
            e.message || `Edge function ${name} failed`
        );
        error.status = e.status || 500;
        error.data = e.data;
        throw error;
    }
}
