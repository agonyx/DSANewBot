import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { players } from '../../db/schema';
import { eq } from 'drizzle-orm';

// Unique per run so it can't collide with real users; cleaned up at the end.
const TEST_DISCORD_ID = `test-api-chars-${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('characters API (live DB)', () => {
    let characterId: number;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, TEST_DISCORD_ID));
        await closeDb();
    });

    it('POST /characters → 201 creates a character (+ stats)', async () => {
        const res = await app.request('/characters', json('POST', { name: 'Test Hero' }));
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.player.name, 'Test Hero');
        assert.equal(body.player.discord_id, TEST_DISCORD_ID);
        assert.ok(body.stats?.id, 'stats row created');
        characterId = body.player.id;
    });

    it('GET /characters → lists it', async () => {
        const res = await app.request('/characters');
        const list = await res.json();
        assert.ok(list.some((p: { id: number }) => p.id === characterId));
    });

    it('GET /characters/me → 404 before selection', async () => {
        const res = await app.request('/characters/me');
        assert.equal(res.status, 404);
    });

    it('POST /characters/:id/select → selects it', async () => {
        const res = await app.request(`/characters/${characterId}/select`, { method: 'POST' });
        assert.equal(res.status, 200);
    });

    it('GET /characters/me → returns the selected sheet', async () => {
        const res = await app.request('/characters/me');
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.player.id, characterId);
        assert.ok(body.stats);
    });

    it('PATCH /characters/stats → updates a stat (visible on next /me)', async () => {
        const res = await app.request('/characters/stats', json('PATCH', { statKey: 'mu', value: 15 }));
        assert.equal(res.status, 200);
        const me = await (await app.request('/characters/me')).json();
        assert.equal(me.stats.mu, 15);
    });

    it('PATCH rejects an invalid stat key → 400', async () => {
        const res = await app.request('/characters/stats', json('PATCH', { statKey: 'evil', value: 1 }));
        assert.equal(res.status, 400);
    });

    it('DELETE /characters/:id → removes it (and /me → 404)', async () => {
        const res = await app.request(`/characters/${characterId}`, { method: 'DELETE' });
        assert.equal(res.status, 200);
        const me = await app.request('/characters/me');
        assert.equal(me.status, 404);
    });
});
