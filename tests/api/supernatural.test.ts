import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { createApiApp } from '../../api';
import { closeDb, db } from '../../db';
import {
    apTransactions,
    liturgies,
    playerTalents,
    players,
    spells,
    stats,
    supernaturalCastings,
    talents,
} from '../../db/schema';

const DISCORD_ID = `test-supernatural-${Date.now()}`;
const EXTERNAL_IDS = [`spell-heal-${Date.now()}`, `spell-ritual-${Date.now()}`, `liturgy-heal-${Date.now()}`];
const app = createApiApp({ resolveCtx: async () => ({ discordId: DISCORD_ID }) });
const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('supernatural API (live DB)', () => {
    let playerId: number;
    let healingSpellId: string;
    let ritualId: string;
    let healingLiturgyId: string;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, DISCORD_ID));
        await db.delete(spells).where(inArray(spells.external_id, EXTERNAL_IDS.slice(0, 2)));
        await db.delete(liturgies).where(eq(liturgies.external_id, EXTERNAL_IDS[2]));
        await closeDb();
    });

    it('sets up a supernatural character and deterministic test catalogs', async () => {
        const created = await (await app.request('/characters', json('POST', { name: 'Mystic Tester' }))).json();
        playerId = created.player.id;
        await app.request(`/characters/${playerId}/select`, { method: 'POST' });
        await db
            .update(stats)
            .set({
                mu: 20,
                kl: 20,
                in: 20,
                ch: 20,
                ff: 20,
                ko: 20,
                le_max: 20,
                le_current: 5,
                asp_max: 20,
                asp_current: 20,
                kap_max: 20,
                kap_current: 20,
                ap_total: 30,
                ap_available: 30,
            })
            .where(eq(stats.player_id, playerId));

        [healingSpellId] = (
            await db
                .insert(spells)
                .values({
                    external_id: EXTERNAL_IDS[0],
                    name: 'Test Balsam',
                    kind: 'SPELL',
                    probe_attr1: 'KL',
                    probe_attr2: 'IN',
                    probe_attr3: 'FF',
                    traditions: ['Gildenmagier'],
                    resource_cost: 4,
                    ap_cost: 2,
                    effect_type: 'HEAL',
                    effect_data: { resourceScaled: true, minimumAmount: 4 },
                })
                .returning({ id: spells.id })
        ).map(row => row.id);
        [ritualId] = (
            await db
                .insert(spells)
                .values({
                    external_id: EXTERNAL_IDS[1],
                    name: 'Test Ritual',
                    kind: 'RITUAL',
                    probe_attr1: 'KL',
                    probe_attr2: 'IN',
                    probe_attr3: 'CH',
                    traditions: ['Gildenmagier'],
                    resource_cost: 2,
                    casting_time_actions: 3,
                    ap_cost: 1,
                    effect_type: 'UTILITY',
                    effect_data: { narrative: true },
                    description: 'A deterministic extended test ritual.',
                })
                .returning({ id: spells.id })
        ).map(row => row.id);
        [healingLiturgyId] = (
            await db
                .insert(liturgies)
                .values({
                    external_id: EXTERNAL_IDS[2],
                    name: 'Test Heilsegen',
                    kind: 'LITURGY',
                    probe_attr1: 'KL',
                    probe_attr2: 'IN',
                    probe_attr3: 'CH',
                    traditions: ['Peraine'],
                    resource_cost: 4,
                    ap_cost: 2,
                    effect_type: 'HEAL',
                    effect_data: { amount: 1, oncePerDay: true },
                })
                .returning({ id: liturgies.id })
        ).map(row => row.id);

        const profile = await app.request(
            '/supernatural/profile',
            json('PATCH', {
                magicalTradition: 'Gildenmagier',
                blessedTradition: 'Peraine',
                deity: 'Peraine',
                favoredTalents: ['Athletik'],
            })
        );
        assert.equal(profile.status, 200);
    });

    it('learns abilities atomically with AP ledger entries', async () => {
        assert.equal(
            (await app.request(`/supernatural/spells/${healingSpellId}/learn`, { method: 'POST' })).status,
            201
        );
        assert.equal((await app.request(`/supernatural/spells/${ritualId}/learn`, { method: 'POST' })).status, 201);
        assert.equal(
            (await app.request(`/supernatural/liturgies/${healingLiturgyId}/learn`, { method: 'POST' })).status,
            201
        );
        const [sheet] = await db.select().from(stats).where(eq(stats.player_id, playerId));
        assert.equal(sheet.ap_available, 25);
        assert.equal(sheet.ap_spent, 5);
        const ledger = await db.select().from(apTransactions).where(eq(apTransactions.player_id, playerId));
        assert.equal(ledger.length, 3);
    });

    it('casts a variable-cost healing spell and spends AsP', async () => {
        const invalid = await app.request(
            '/supernatural/cast',
            json('POST', { abilityType: 'INVALID', abilityId: healingSpellId })
        );
        assert.equal(invalid.status, 400);
        const response = await app.request(
            '/supernatural/cast',
            json('POST', { abilityType: 'SPELL', abilityId: healingSpellId, resourceAmount: 4 })
        );
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.equal(result.success, true);
        assert.equal(result.effectResult.type, 'HEAL');
        const [sheet] = await db.select().from(stats).where(eq(stats.player_id, playerId));
        assert.equal(sheet.le_current, 9);
        assert.equal(sheet.asp_current, 16);
    });

    it('persists and completes an extended ritual', async () => {
        const started = await (
            await app.request('/supernatural/cast', json('POST', { abilityType: 'SPELL', abilityId: ritualId }))
        ).json();
        assert.equal(started.pending, true);
        assert.equal(started.casting.status, 'PENDING');
        await db
            .update(supernaturalCastings)
            .set({ completes_at: new Date(Date.now() - 1000) })
            .where(eq(supernaturalCastings.id, started.casting.id));
        const completed = await app.request(`/supernatural/castings/${started.casting.id}/complete`, {
            method: 'POST',
        });
        assert.equal(completed.status, 200);
        assert.equal((await completed.json()).casting.status, 'COMPLETED');
    });

    it('cancels an extended ritual atomically and retains half the committed cost', async () => {
        const started = await (
            await app.request('/supernatural/cast', json('POST', { abilityType: 'SPELL', abilityId: ritualId }))
        ).json();
        assert.equal(started.casting.status, 'PENDING');
        const cancelled = await app.request(`/supernatural/castings/${started.casting.id}/cancel`, {
            method: 'POST',
        });
        assert.equal(cancelled.status, 200);
        const result = await cancelled.json();
        assert.equal(result.casting.status, 'CANCELLED');
        assert.equal(result.refund, 1);
        assert.equal(result.retainedCost, 1);
        const [sheet] = await db.select().from(stats).where(eq(stats.player_id, playerId));
        assert.equal(sheet.asp_current, 13);
    });

    it('performs a learned liturgy and a favored-talent miracle', async () => {
        const liturgy = await app.request(
            '/supernatural/cast',
            json('POST', { abilityType: 'LITURGY', abilityId: healingLiturgyId })
        );
        assert.equal(liturgy.status, 201);
        assert.equal(
            (
                await app.request(
                    '/supernatural/cast',
                    json('POST', { abilityType: 'LITURGY', abilityId: healingLiturgyId })
                )
            ).status,
            409
        );
        const [athletics] = await db
            .select({ id: talents.id })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(and(eq(playerTalents.player_id, playerId), eq(talents.name, 'Athletik')))
            .limit(1);
        assert.ok(athletics);
        const miracle = await app.request(
            '/supernatural/miracle',
            json('POST', { mode: 'TALENT', talentId: athletics.id })
        );
        assert.equal(miracle.status, 201);
        const body = await miracle.json();
        assert.equal(body.kapCost, 4);
        assert.equal(body.talent, 'Athletik');
    });
});
