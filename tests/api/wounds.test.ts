import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createApiApp } from '../../api';
import { closeDb, db } from '../../db';
import { players, woundTreatments } from '../../db/schema';

const HEALER_DISCORD_ID = `test-api-wounds-healer-${Date.now()}`;
const TARGET_DISCORD_ID = `test-api-wounds-target-${Date.now()}`;
const healerApp = createApiApp({ resolveCtx: async () => ({ discordId: HEALER_DISCORD_ID }) });
const targetApp = createApiApp({ resolveCtx: async () => ({ discordId: TARGET_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

async function createSelectedCharacter(app: ReturnType<typeof createApiApp>, name: string) {
    const createdResponse = await app.request('/characters', json('POST', { name }));
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal((await app.request(`/characters/${created.player.id}/select`, { method: 'POST' })).status, 200);
    return created.player.id as number;
}

describe('wound treatment API (live DB)', () => {
    let healerPlayerId: number;
    let targetPlayerId: number;

    after(async () => {
        await db.delete(players).where(and(eq(players.discord_id, HEALER_DISCORD_ID), eq(players.selected, 'YES')));
        await db.delete(players).where(and(eq(players.discord_id, TARGET_DISCORD_ID), eq(players.selected, 'YES')));
        await closeDb();
    });

    it('creates selected healer and target characters', async () => {
        healerPlayerId = await createSelectedCharacter(healerApp, 'Wound Healer');
        targetPlayerId = await createSelectedCharacter(targetApp, 'Wound Target');
    });

    it('rejects invalid treatment modifiers before rolling', async () => {
        const response = await healerApp.request(
            '/wounds/treat',
            json('POST', { treatmentType: 'healing', modifier: 21 })
        );
        assert.equal(response.status, 400);
    });

    it('prevents a normal caller from treating another out-of-combat character', async () => {
        const response = await healerApp.request(
            '/wounds/treat',
            json('POST', { treatmentType: 'healing', targetPlayerId })
        );
        assert.equal(response.status, 403);
    });

    it('records an authorized self-treatment and returns the resolved probe', async () => {
        const response = await healerApp.request('/wounds/treat', json('POST', { treatmentType: 'healing' }));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.treatmentType, 'healing');
        assert.equal(result.healerName, 'Wound Healer');
        assert.equal(result.targetName, 'Wound Healer');
        assert.equal(result.rolls.length, 3);
        assert.equal(typeof result.success, 'boolean');
        assert.ok(result.qualityLevel >= 0 && result.qualityLevel <= 6);

        const rows = await db
            .select()
            .from(woundTreatments)
            .where(
                and(
                    eq(woundTreatments.healer_player_id, healerPlayerId),
                    eq(woundTreatments.target_player_id, healerPlayerId)
                )
            );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].treatment_type, 'healing');
        assert.equal(rows[0].success, result.success);
        assert.equal(rows[0].quality_level, result.qualityLevel);
    });

    it('rejects stabilization while the target still has positive LeP', async () => {
        const response = await healerApp.request('/wounds/treat', json('POST', { treatmentType: 'stabilize' }));
        assert.equal(response.status, 400);
    });
});
