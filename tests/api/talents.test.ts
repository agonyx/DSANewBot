import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { players } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { calculateQS, evaluateProbe } from '../../services/talents';

const TEST_DISCORD_ID = `test-api-tal-${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('talent probe math (pure)', () => {
    it('calculateQS maps remaining FtW → DSA quality level', () => {
        assert.equal(calculateQS(16), 6);
        assert.equal(calculateQS(15), 5);
        assert.equal(calculateQS(13), 5);
        assert.equal(calculateQS(12), 4);
        assert.equal(calculateQS(10), 4);
        assert.equal(calculateQS(9), 3);
        assert.equal(calculateQS(7), 3);
        assert.equal(calculateQS(6), 2);
        assert.equal(calculateQS(4), 2);
        assert.equal(calculateQS(3), 1);
        assert.equal(calculateQS(0), 1); // success edge: exactly 0 left is still QS 1
    });

    it('evaluateProbe: all dice under attributes → no FtW spent, success', () => {
        const r = evaluateProbe({
            attrCodes: ['MU', 'KL', 'IN'],
            attrValues: [13, 13, 13],
            baseFtw: 5,
            modifier: 0,
            rolls: [1, 1, 1],
        });
        assert.equal(r.success, true);
        assert.equal(r.effectiveFtw, 5);
        assert.equal(r.remainingFtw, 5);
        assert.equal(r.qs, 2); // 5 → QS 2
        assert.deepEqual(r.checkResults.map((c) => c.needed), [0, 0, 0]);
    });

    it('evaluateProbe: dice over attributes drain FtW → failure when exhausted', () => {
        const r = evaluateProbe({
            attrCodes: ['MU', 'KL', 'IN'],
            attrValues: [8, 8, 8],
            baseFtw: 5,
            modifier: 0,
            rolls: [20, 20, 20],
        });
        assert.equal(r.success, false);
        assert.equal(r.qs, 0);
        assert.equal(r.remainingFtw, 5 - 36);
        assert.deepEqual(r.checkResults.map((c) => c.needed), [12, 12, 12]);
    });

    it('evaluateProbe: modifier contributes to the effective FtW pool', () => {
        const r = evaluateProbe({
            attrCodes: ['MU', 'KL', 'IN'],
            attrValues: [10, 10, 10],
            baseFtw: 0,
            modifier: 6,
            rolls: [12, 12, 12],
        });
        assert.equal(r.effectiveFtw, 6);
        // each die overshoots by 2 → 6 needed total → exactly 0 left → success QS 1
        assert.equal(r.remainingFtw, 0);
        assert.equal(r.success, true);
        assert.equal(r.qs, 1);
    });
});

describe('talents API (live DB)', () => {
    let characterId: number;
    let learnedTalentId: number;
    let learnedStatCodes: [string, string, string];

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, TEST_DISCORD_ID));
        await closeDb();
    });

    it('setup: create + select a character', async () => {
        const r = await app.request('/characters', json('POST', { name: 'Tal Tester' }));
        assert.equal(r.status, 201);
        characterId = (await r.json()).player.id;
        const sel = await app.request(`/characters/${characterId}/select`, { method: 'POST' });
        assert.equal(sel.status, 200);
    });

    it('GET /talents → non-empty catalog with probe attributes', async () => {
        const list = await (await app.request('/talents')).json();
        assert.ok(Array.isArray(list));
        assert.ok(list.length > 0, 'talent catalog should be seeded');
        const first = list[0];
        assert.ok(first.id && first.name && first.stat1 && first.stat2 && first.stat3);
        learnedTalentId = first.id;
        learnedStatCodes = [first.stat1, first.stat2, first.stat3];
    });

    it('POST /talents/skills → 201 learns a talent at a given FtW', async () => {
        const r = await app.request('/talents/skills', json('POST', { talentId: learnedTalentId, ftw: 7 }));
        assert.equal(r.status, 201);
        const skill = await r.json();
        assert.equal(skill.ftw, 7);
        assert.equal(skill.talent_id, learnedTalentId);
    });

    it('GET /talents/skills → lists the learned skill', async () => {
        const list = await (await app.request('/talents/skills')).json();
        assert.ok(list.some((s: { talent_id: number }) => s.talent_id === learnedTalentId));
        const skill = list.find((s: { talent_id: number }) => s.talent_id === learnedTalentId);
        assert.equal(skill.ftw, 7);
        assert.ok(skill.talent_name);
    });

    it('POST /talents/skills on an already-learned talent → upsert (re-rate, no duplicate)', async () => {
        const r = await app.request('/talents/skills', json('POST', { talentId: learnedTalentId, ftw: 12 }));
        assert.equal(r.status, 201);
        const list = await (await app.request('/talents/skills')).json();
        const matching = list.filter((s: { talent_id: number }) => s.talent_id === learnedTalentId);
        assert.equal(matching.length, 1, 'upsert must not create a duplicate player_talent row');
        assert.equal(matching[0].ftw, 12);
    });

    it('POST /talents/skills rejects a negative FtW → 400', async () => {
        const r = await app.request('/talents/skills', json('POST', { talentId: learnedTalentId, ftw: -1 }));
        assert.equal(r.status, 400);
    });

    it('POST /talents/skills rejects an unknown talentId → 404', async () => {
        const r = await app.request('/talents/skills', json('POST', { talentId: 999999, ftw: 3 }));
        assert.equal(r.status, 404);
    });

    it('POST /talents/probe → resolves the learned talent (guaranteed success at high attrs)', async () => {
        // Push the three probe attributes to 18 so success is guaranteed
        // regardless of the dice (worst case: three 20s → 6 needed, 12 FtW left).
        for (const code of learnedStatCodes) {
            const r = await app.request('/characters/stats', json('PATCH', { statKey: code.toLowerCase(), value: 18 }));
            assert.equal(r.status, 200, `patch stat ${code}`);
        }

        const r = await app.request('/talents/probe', json('POST', { talentId: learnedTalentId, modifier: 0 }));
        assert.equal(r.status, 200);
        const res = await r.json();
        assert.equal(res.talent.id, learnedTalentId);
        assert.equal(res.success, true);
        assert.ok(res.qs >= 1 && res.qs <= 6);
        assert.equal(res.rolls.length, 3);
        assert.ok(res.rolls.every((d: number) => d >= 1 && d <= 20));
        assert.equal(res.checkResults.length, 3);
        assert.equal(res.baseFtw, 12);
        assert.equal(res.modifier, 0);
    });

    it('POST /talents/probe on a non-existent talent → 404', async () => {
        // Note: createPlayer seeds a player_talents row for every catalog talent at
        // FtW 0, so any real catalog talent is probe-able (a failed probe is still
        // 200). The 404 path only fires for a talent id that has no player_talents
        // row for this character — e.g. a bogus id, or a talent added to the
        // catalog after the character was created.
        const r = await app.request('/talents/probe', json('POST', { talentId: 999999, modifier: 0 }));
        assert.equal(r.status, 404);
    });
});
