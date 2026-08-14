import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { players, stats } from '../../db/schema';
import { eq } from 'drizzle-orm';

const TEST_DISCORD_ID = `test-api-res-${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

const setStat = (statKey: string, value: number) => app.request('/characters/stats', json('PATCH', { statKey, value }));

describe('resources API (live DB)', () => {
    let characterId: number;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, TEST_DISCORD_ID));
        await closeDb();
    });

    it('setup: create + select a character and set its pools', async () => {
        const r = await app.request('/characters', json('POST', { name: 'Res Tester' }));
        assert.equal(r.status, 201);
        characterId = (await r.json()).player.id;
        assert.equal((await app.request(`/characters/${characterId}/select`, { method: 'POST' })).status, 200);

        // SchP 5/10, LeP 10/20, AsP 3/10 (KaP stays 0 → non-blessed)
        for (const [k, v] of [
            ['schicksalspunkte_max', 10],
            ['schicksalspunkte_current', 5],
            ['le_max', 20],
            ['le_current', 10],
            ['asp_max', 10],
            ['asp_current', 3],
        ] as [string, number][]) {
            assert.equal((await setStat(k, v)).status, 200);
        }
    });

    it('GET /resources/schicksalspunkte → shows current/max', async () => {
        const res = await (await app.request('/resources/schicksalspunkte')).json();
        assert.equal(res.current, 5);
        assert.equal(res.max, 10);
        assert.equal(res.characterName, 'Res Tester');
    });

    it('POST /resources/schicksalspunkte/spend → decrements', async () => {
        await setStat('schicksalspunkte_current', 5);
        const res = await (await app.request('/resources/schicksalspunkte/spend', json('POST', { amount: 3 }))).json();
        assert.equal(res.oldValue, 5);
        assert.equal(res.newValue, 2);
    });

    it('POST /resources/:type/spend over balance → 400', async () => {
        await setStat('schicksalspunkte_current', 5);
        const r = await app.request('/resources/schicksalspunkte/spend', json('POST', { amount: 100 }));
        assert.equal(r.status, 400);
    });

    it('POST /resources/:type/restore caps at max and reports actualAmount', async () => {
        await setStat('schicksalspunkte_current', 5);
        const res = await (
            await app.request('/resources/schicksalspunkte/restore', json('POST', { amount: 50 }))
        ).json();
        assert.equal(res.newValue, 10);
        assert.equal(res.actualAmount, 5);
    });

    it('restore at max → actualAmount 0, no change', async () => {
        await setStat('schicksalspunkte_current', 10);
        const res = await (
            await app.request('/resources/schicksalspunkte/restore', json('POST', { amount: 5 }))
        ).json();
        assert.equal(res.actualAmount, 0);
        assert.equal(res.newValue, 10);
    });

    it('PUT /resources/:type sets an exact value', async () => {
        await setStat('schicksalspunkte_current', 5);
        const res = await (await app.request('/resources/schicksalspunkte', json('PUT', { value: 7 }))).json();
        assert.equal(res.newValue, 7);
    });

    it('PUT /resources/:type clamps high to max', async () => {
        const res = await (await app.request('/resources/schicksalspunkte', json('PUT', { value: 999 }))).json();
        assert.equal(res.newValue, 10);
    });

    it('PUT /resources/:type rejects a negative value → 400', async () => {
        const r = await app.request('/resources/schicksalspunkte', json('PUT', { value: -1 }));
        assert.equal(r.status, 400);
    });

    it('POST /heal restores LeP capped at le_max', async () => {
        await setStat('le_current', 10);
        const res = await (await app.request('/heal', json('POST', { amount: 50 }))).json();
        assert.equal(res.newValue, 20);
        assert.equal(res.actualHeal, 10);
    });

    it('POST /heal at full → actualHeal 0', async () => {
        await setStat('le_current', 20);
        const res = await (await app.request('/heal', json('POST', { amount: 5 }))).json();
        assert.equal(res.actualHeal, 0);
    });

    it('POST /regenerate rolls recovery bounded by max for each pool', async () => {
        await setStat('le_current', 10);
        await setStat('asp_current', 3);
        const res = await (await app.request('/regenerate', json('POST', {}))).json();
        assert.equal(res.alreadyFull, false);
        const types = res.results.map((r: { type: string }) => r.type);
        assert.ok(types.includes('lep'));
        assert.ok(types.includes('asp'));
        assert.ok(!types.includes('kap'), 'non-blessed character should not regenerate KaP');
        for (const r of res.results) {
            assert.ok(r.newValue >= r.oldValue && r.newValue <= r.maxValue, `${r.type} out of bounds`);
        }
    });

    it('POST /regenerate consumes treatment state and heals one aggregate wound', async () => {
        await setStat('le_current', 20);
        await setStat('asp_current', 10);
        await setStat('wounds', 2);
        await db
            .update(stats)
            .set({ pending_healing_bonus: 3, pain_suppression: 2, pain_suppression_phases: 1 })
            .where(eq(stats.player_id, characterId));

        const res = await (await app.request('/regenerate', json('POST', {}))).json();
        assert.equal(res.alreadyFull, false);
        assert.equal(res.woundsBefore, 2);
        assert.equal(res.woundsHealed, 1);
        assert.equal(res.woundsAfter, 1);
        assert.equal(res.healingBonusApplied, 3);
        assert.equal(res.painSuppressionExpired, true);

        const [row] = await db.select().from(stats).where(eq(stats.player_id, characterId));
        assert.equal(row.wounds, 1);
        assert.equal(row.pending_healing_bonus, 0);
        assert.equal(row.pain_suppression, 0);
        assert.equal(row.pain_suppression_phases, 0);
    });

    it('POST /regenerate when fully rested → alreadyFull true', async () => {
        await setStat('le_current', 20); // le_max=20
        await setStat('asp_current', 10); // asp_max=10
        await setStat('wounds', 0);
        const res = await (await app.request('/regenerate', json('POST', {}))).json();
        assert.equal(res.alreadyFull, true);
        assert.equal(res.results.length, 0);
    });
});
