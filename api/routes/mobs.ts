import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as mobs from '../../services/mobs';

type AppEnv = { Variables: { ctx: Ctx } };

/** /api/mobs — mob template CRUD (global reference data; ctx-authenticated). */
export const mobRoutes = new Hono<AppEnv>();

mobRoutes.get('/', async (c) => c.json(await mobs.listMobs(c.get('ctx'))));

mobRoutes.post('/', async (c) => {
    const body = await c.req.json();
    return c.json(await mobs.createMob(c.get('ctx'), body), 201);
});

mobRoutes.get('/:id', async (c) => c.json(await mobs.getMobById(c.get('ctx'), Number(c.req.param('id')))));

mobRoutes.patch('/:id', async (c) => {
    const { patch } = await c.req.json<{ patch: Record<string, unknown> }>();
    return c.json(await mobs.updateMob(c.get('ctx'), { id: Number(c.req.param('id')), patch }));
});

mobRoutes.delete('/:id', async (c) => {
    await mobs.deleteMob(c.get('ctx'), Number(c.req.param('id')));
    return c.json({ deleted: true });
});
