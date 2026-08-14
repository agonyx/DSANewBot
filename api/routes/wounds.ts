import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import { treatWounds, type WoundTreatmentType } from '../../services/wounds';

type AppEnv = { Variables: { ctx: Ctx } };

/** Authenticated Heilkunde Wunden applications. */
export const woundRoutes = new Hono<AppEnv>();

woundRoutes.post('/treat', async c => {
    const body = await c.req.json<{
        treatmentType: WoundTreatmentType;
        targetPlayerId?: number;
        combatantId?: string;
        modifier?: number;
    }>();
    return c.json(await treatWounds(c.get('ctx'), body));
});
