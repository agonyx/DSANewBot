import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Ctx } from '../services/_ctx';
import { apiOnError } from './middleware/error';
import { authRoutes, resolveJwtCtx } from './auth';
import { characterRoutes } from './routes/characters';
import { inventoryRoutes } from './routes/inventory';
import { talentRoutes } from './routes/talents';
import { resourceRoutes } from './routes/resources';
import { mobRoutes } from './routes/mobs';
import { ruleRoutes } from './routes/rules';
import { combatRoutes } from './routes/combat';
import { woundRoutes } from './routes/wounds';
import { maneuverRoutes } from './routes/maneuvers';
import { supernaturalRoutes } from './routes/supernatural';
import { economyRoutes } from './routes/economy';
import { advancementRoutes } from './routes/advancement';
import { diceMacroRoutes } from './routes/diceMacros';
import { campaignRoutes } from './routes/campaign';
import { characterRecordRoutes } from './routes/characterRecords';

/**
 * The API app. Mounted under /api by server.ts. Discord commands call the same
 * services in-process; the website calls these routes over HTTP (Bearer JWT).
 *
 * `createApiApp({ resolveCtx })` lets tests inject a fixed ctx (no real OAuth).
 */
export interface CreateApiOptions {
    resolveCtx?: (c: Context) => Promise<Ctx> | Ctx;
}

type AppEnv = { Variables: { ctx: Ctx } };

export function createApiApp(opts: CreateApiOptions = {}) {
    const app = new Hono<AppEnv>();
    app.onError(apiOnError);

    // --- Public routes ---
    app.get('/health', c => c.json({ status: 'ok' }));
    app.route('/auth', authRoutes);

    // --- Protected routes (ctx required on every route) ---
    const protectedApp = new Hono<AppEnv>();
    protectedApp.onError(apiOnError);
    protectedApp.use('*', async (c, next) => {
        const ctx = opts.resolveCtx ? await opts.resolveCtx(c) : await resolveJwtCtx(c);
        c.set('ctx', ctx);
        return next();
    });
    registerProtectedRoutes(protectedApp);
    app.route('/', protectedApp);

    return app;
}

/**
 * All authenticated routes live here. Phase A: just /me (proves the ctx flow).
 * Phase B adds: app.route('/characters', characterRoutes); /inventory; /talents; ...
 */
function registerProtectedRoutes(app: Hono<AppEnv>) {
    app.get('/me', c => c.json({ discordId: c.get('ctx').discordId }));
    app.route('/characters', characterRoutes);
    app.route('/', inventoryRoutes);
    app.route('/talents', talentRoutes);
    app.route('/', resourceRoutes);
    app.route('/mobs', mobRoutes);
    app.route('/rules', ruleRoutes);
    app.route('/combat', combatRoutes);
    app.route('/wounds', woundRoutes);
    app.route('/maneuvers', maneuverRoutes);
    app.route('/supernatural', supernaturalRoutes);
    app.route('/economy', economyRoutes);
    app.route('/advancement', advancementRoutes);
    app.route('/dice-macros', diceMacroRoutes);
    app.route('/campaigns', campaignRoutes);
    app.route('/character-records', characterRecordRoutes);
}
