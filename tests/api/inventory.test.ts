import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { players } from '../../db/schema';
import { eq } from 'drizzle-orm';

const TEST_DISCORD_ID = `test-api-inv-${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('inventory API (live DB)', () => {
    let characterId: number;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, TEST_DISCORD_ID));
        await closeDb();
    });

    it('setup: create + select a character', async () => {
        const r = await app.request('/characters', json('POST', { name: 'Inv Tester' }));
        assert.equal(r.status, 201);
        characterId = (await r.json()).player.id;
        const sel = await app.request(`/characters/${characterId}/select`, { method: 'POST' });
        assert.equal(sel.status, 200);
    });

    it('POST /weapons → 201 equipped weapon; GET /weapons lists it', async () => {
        const r = await app.request(
            '/weapons',
            json('POST', {
                name: 'Sword',
                type: 'MELEE',
                tp: '1w6+3',
                at: 12,
                pa: 8,
                is_equipped: 'Y',
                equipped_slot: 'OFFENSE',
            })
        );
        assert.equal(r.status, 201);
        const w = await r.json();
        assert.equal(w.is_equipped, 'Y');
        assert.equal(w.equipped_slot, 'OFFENSE');
        const list = await (await app.request('/weapons')).json();
        assert.ok(list.some((x: { id: number }) => x.id === w.id));
    });

    it('POST /weapons rejects bad TP format → 400', async () => {
        const r = await app.request('/weapons', json('POST', { name: 'Bad', type: 'MELEE', tp: 'nope', at: 1, pa: 1 }));
        assert.equal(r.status, 400);
    });

    it('validates and persists ranged combat metadata', async () => {
        const invalid = await app.request(
            '/weapons',
            json('POST', {
                name: 'Bad bow',
                type: 'RANGED',
                combatTechnique: 'Bögen',
                tp: '1w6',
                at: 12,
                pa: 0,
                rangeClose: 50,
                rangeMedium: 10,
                rangeFar: 100,
            })
        );
        assert.equal(invalid.status, 400);

        const created = await (
            await app.request(
                '/weapons',
                json('POST', {
                    name: 'Test bow',
                    type: 'RANGED',
                    combatTechnique: 'Bögen',
                    tp: '1w6+2',
                    at: 14,
                    pa: 0,
                    rangeClose: 10,
                    rangeMedium: 50,
                    rangeFar: 100,
                    reloadActions: 2,
                    isTwoHanded: true,
                })
            )
        ).json();
        assert.equal(created.combat_technique, 'Bögen');
        assert.equal(created.range_medium, 50);
        assert.equal(created.reload_actions, 2);
        assert.equal(created.is_two_handed, true);
    });

    it('POST /items → stacks same name+type', async () => {
        await app.request('/items', json('POST', { name: 'Potion', type: 'POTION', quantity: 2 }));
        const b = await (
            await app.request('/items', json('POST', { name: 'Potion', type: 'POTION', quantity: 3 }))
        ).json();
        assert.equal(b.quantity, 5);
    });

    it('GET /items → lists the stacked item', async () => {
        const list = await (await app.request('/items')).json();
        assert.ok(list.some((x: { name: string }) => x.name === 'Potion'));
    });
});
