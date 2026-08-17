import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { mobs } from '../../db/schema';
import { eq } from 'drizzle-orm';

const TEST_DISCORD_ID = `test-api-mob-${Date.now()}`;
const MOB_NAME = `Test Mob ${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('mobs API (live DB)', () => {
    let mobId: number;

    after(async () => {
        // Mobs are global reference data — clean up the templates we created.
        await db.delete(mobs).where(eq(mobs.name, MOB_NAME));
        await db.delete(mobs).where(eq(mobs.name, `${MOB_NAME} Dup`));
        await closeDb();
    });

    it('POST /mobs → 201 creates a mob template', async () => {
        const r = await app.request('/mobs', json('POST', {
            name: MOB_NAME,
            base_max_hp: 30,
            base_initiative: 12,
            base_attack_value: 14,
            base_parry_value: 10,
            base_armor_soak: 2,
            base_damage_tp: '1w6+2',
            description: 'A test goblin',
        }));
        assert.equal(r.status, 201);
        const mob = await r.json();
        assert.equal(mob.name, MOB_NAME);
        assert.equal(mob.base_max_hp, 30);
        assert.equal(mob.base_damage_tp, '1w6+2');
        mobId = mob.id;
    });

    it('POST /mobs duplicate name → 409', async () => {
        const r = await app.request('/mobs', json('POST', {
            name: MOB_NAME,
            base_max_hp: 1, base_initiative: 1, base_attack_value: 1,
            base_parry_value: 1, base_armor_soak: 1, base_damage_tp: '1w6',
        }));
        assert.equal(r.status, 409);
    });

    it('POST /mobs bad damage format → 400', async () => {
        const r = await app.request('/mobs', json('POST', {
            name: `${MOB_NAME} Bad`,
            base_max_hp: 1, base_initiative: 1, base_attack_value: 1,
            base_parry_value: 1, base_armor_soak: 1, base_damage_tp: 'nope',
        }));
        assert.equal(r.status, 400);
    });

    it('GET /mobs → lists the created template', async () => {
        const list = await (await app.request('/mobs')).json();
        assert.ok(Array.isArray(list));
        assert.ok(list.some((m: { id: number }) => m.id === mobId));
    });

    it('GET /mobs/:id → detail', async () => {
        const mob = await (await app.request(`/mobs/${mobId}`)).json();
        assert.equal(mob.id, mobId);
        assert.equal(mob.name, MOB_NAME);
        assert.equal(mob.description, 'A test goblin');
    });

    it('GET /mobs/:id unknown → 404', async () => {
        const r = await app.request('/mobs/9999999');
        assert.equal(r.status, 404);
    });

    it('PATCH /mobs/:id → updates a field and returns the refreshed row', async () => {
        const r = await app.request(`/mobs/${mobId}`, json('PATCH', { patch: { base_max_hp: 50 } }));
        assert.equal(r.status, 200);
        const mob = await r.json();
        assert.equal(mob.base_max_hp, 50);
        // Unknown columns are silently dropped (no error, no change to known cols)
        const r2 = await app.request(`/mobs/${mobId}`, json('PATCH', { patch: { bogus_col: 123 } }));
        assert.equal(r2.status, 200);
    });

    it('PATCH rejects a bad damage format → 400', async () => {
        const r = await app.request(`/mobs/${mobId}`, json('PATCH', { patch: { base_damage_tp: 'bad' } }));
        assert.equal(r.status, 400);
    });

    it('DELETE /mobs/:id → removes it (and GET → 404)', async () => {
        assert.equal((await app.request(`/mobs/${mobId}`, { method: 'DELETE' })).status, 200);
        assert.equal((await app.request(`/mobs/${mobId}`)).status, 404);
    });

    it('DELETE /mobs/:id unknown → 404', async () => {
        assert.equal((await app.request('/mobs/9999999', { method: 'DELETE' })).status, 404);
    });
});
