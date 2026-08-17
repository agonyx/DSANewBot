/**
 * Minimal co-hosted HTTP server (Hono). Provides liveness/readiness probes and a
 * future seam for an HTTP API or dashboard. Intentionally small — add endpoints
 * only when there's a concrete consumer.
 *
 *   GET /health — process is up (always 200)
 *   GET /ready  — Postgres pool answers `select 1` (503 if not)
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { pool } from './db';
import { createApiApp } from './api';
import { createLogger } from './utils/logger';

const log = createLogger('server');

const app = new Hono();

// API (Discord OAuth2-protected) — services shared with the in-process bot commands.
app.route('/api', createApiApp());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/ready', async (c) => {
    try {
        await pool`select 1`;
        return c.json({ status: 'ready' });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message }, 'Readiness check failed');
        return c.json({ status: 'unavailable', error: message }, 503);
    }
});

const PORT = Number(process.env.PORT) || 8080;

/** Start the HTTP listener. Call once at bot boot when DATABASE_URL is configured. */
export function startServer(): Hono {
    serve({ fetch: app.fetch, port: PORT }, (info) => {
        log.info({ port: info.port }, 'HTTP server listening (health/ready)');
    });
    return app;
}
