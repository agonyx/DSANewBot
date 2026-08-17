import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as talents from '../../services/talents';

type AppEnv = { Variables: { ctx: Ctx } };

/**
 * /api/talents — talent catalog + Talentprobe resolution + learned skills.
 * All ctx-authenticated (operate on the caller's selected character).
 */
export const talentRoutes = new Hono<AppEnv>();

/** Resolve a 3d20 Talentprobe for one of the caller's learned talents. */
talentRoutes.post('/probe', async c => {
    const { talentId, modifier } = await c.req.json<{ talentId: number; modifier?: number }>();
    return c.json(await talents.resolveProbe(c.get('ctx'), { talentId, modifier }));
});

/** The full talent catalog (reference data). */
talentRoutes.get('/', async c => c.json(await talents.listTalents(c.get('ctx'))));

/** The caller's learned talents (skills). */
talentRoutes.get('/skills', async c => c.json(await talents.listSkills(c.get('ctx'))));

/** Explicit owner/tabletop override for importing or correcting a paper-sheet talent value. */
talentRoutes.post('/skills', async c => {
    const { talentId, ftw } = await c.req.json<{ talentId: number; ftw: number }>();
    return c.json(await talents.assignSkill(c.get('ctx'), { talentId, ftw }), 201);
});
