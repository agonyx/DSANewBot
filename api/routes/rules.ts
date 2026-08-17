import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as rules from '../../services/rules';

type AppEnv = { Variables: { ctx: Ctx } };

/** /api/rules — rule knowledge base search (public reference data; ctx-authenticated). */
export const ruleRoutes = new Hono<AppEnv>();

ruleRoutes.get('/search', async (c) => {
    const query = c.req.query('q') ?? '';
    const category = c.req.query('category') || null;
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
    return c.json(await rules.searchRules(c.get('ctx'), { query, category, limit }));
});

ruleRoutes.get('/pages/:doc_id', async (c) =>
    c.json(await rules.getRulePage(c.get('ctx'), c.req.param('doc_id')))
);
