import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as resources from '../../services/resources';
import type { ResourceKey } from '../../services/resources';

type AppEnv = { Variables: { ctx: Ctx } };

const RESOURCE_KEYS = new Set<ResourceKey>(['schicksalspunkte', 'asp', 'kap']);

/** /api/resources (SchP/AsP/KaP), /api/heal (LeP), /api/regenerate — ctx-authenticated. */
export const resourceRoutes = new Hono<AppEnv>();

resourceRoutes.get('/resources/:type', async (c) => {
    const type = c.req.param('type') as ResourceKey;
    if (!RESOURCE_KEYS.has(type)) return c.json({ error: 'Invalid resource type' }, 400);
    const targetDiscordId = c.req.query('target');
    return c.json(await resources.getResource(c.get('ctx'), { type, targetDiscordId }));
});

resourceRoutes.post('/resources/:type/spend', async (c) => {
    const type = c.req.param('type') as ResourceKey;
    if (!RESOURCE_KEYS.has(type)) return c.json({ error: 'Invalid resource type' }, 400);
    const { amount, targetDiscordId } = await c.req.json<{ amount: number; targetDiscordId?: string }>();
    return c.json(await resources.spendResource(c.get('ctx'), { type, amount, targetDiscordId }));
});

resourceRoutes.post('/resources/:type/restore', async (c) => {
    const type = c.req.param('type') as ResourceKey;
    if (!RESOURCE_KEYS.has(type)) return c.json({ error: 'Invalid resource type' }, 400);
    const { amount, targetDiscordId } = await c.req.json<{ amount: number; targetDiscordId?: string }>();
    return c.json(await resources.restoreResource(c.get('ctx'), { type, amount, targetDiscordId }));
});

resourceRoutes.put('/resources/:type', async (c) => {
    const type = c.req.param('type') as ResourceKey;
    if (!RESOURCE_KEYS.has(type)) return c.json({ error: 'Invalid resource type' }, 400);
    const { value, targetDiscordId } = await c.req.json<{ value: number; targetDiscordId?: string }>();
    return c.json(await resources.setResource(c.get('ctx'), { type, value, targetDiscordId }));
});

resourceRoutes.post('/heal', async (c) => {
    const { amount, targetDiscordId } = await c.req.json<{ amount: number; targetDiscordId?: string }>();
    return c.json(await resources.healCharacter(c.get('ctx'), { amount, targetDiscordId }));
});

resourceRoutes.post('/regenerate', async (c) => {
    const { targetDiscordId } = await c.req.json<{ targetDiscordId?: string }>();
    return c.json(await resources.regenerate(c.get('ctx'), { targetDiscordId }));
});
