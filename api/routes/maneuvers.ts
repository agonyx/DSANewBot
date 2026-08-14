import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import { getManeuver, listManeuvers } from '../../services/maneuvers';

type AppEnv = { Variables: { ctx: Ctx } };

export const maneuverRoutes = new Hono<AppEnv>();

maneuverRoutes.get('/', async c => {
    const type = c.req.query('type');
    const actionType = ['MELEE', 'RANGED', 'MAGIC'].includes(type || '')
        ? (type as 'MELEE' | 'RANGED' | 'MAGIC')
        : undefined;
    return c.json(await listManeuvers(c.get('ctx'), actionType));
});

maneuverRoutes.get('/:maneuverId', async c => c.json(await getManeuver(c.get('ctx'), c.req.param('maneuverId'))));
