import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createApiApp } from '../../api';
import { closeDb, db } from '../../db';
import {
    actionModifications,
    apTransactions,
    playerActionModifications,
    playerSpecialAbilities,
    playerSpells,
    playerTalents,
    players,
    spells,
    specialAbilities,
    stats,
    supernaturalProfiles,
    talents,
} from '../../db/schema';

const SUFFIX = `${Date.now()}-${Math.random()}`;
const DISCORD_ID = `test-advancement-${SUFFIX}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: DISCORD_ID }) });
const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('advancement API (live DB)', () => {
    let playerId: number;
    let talentId: number;
    let spellId: string;
    let abilityId: string;
    let catalogAbilityId: string;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, DISCORD_ID));
        await db.delete(talents).where(eq(talents.name, `Test Talent ${SUFFIX}`));
        await db.delete(spells).where(eq(spells.external_id, `advance-spell-${SUFFIX}`));
        await db.delete(actionModifications).where(eq(actionModifications.name, `Test Ability ${SUFFIX}`));
        await db.delete(specialAbilities).where(eq(specialAbilities.external_id, `advance-special-${SUFFIX}`));
        await closeDb();
    });

    it('creates and selects an isolated advancement character', async () => {
        const created = await (await app.request('/characters', json('POST', { name: 'Advancement Tester' }))).json();
        playerId = created.player.id;
        assert.equal((await app.request(`/characters/${playerId}/select`, { method: 'POST' })).status, 200);

        [talentId] = (
            await db
                .insert(talents)
                .values({
                    name: `Test Talent ${SUFFIX}`,
                    stat1: 'MU',
                    stat2: 'KL',
                    stat3: 'IN',
                    category: 'Wissen',
                    advancement_factor: 'C',
                    affected_by_encumbrance: false,
                })
                .returning({ id: talents.id })
        ).map(row => row.id);
        await db.insert(playerTalents).values({ player_id: playerId, talent_id: talentId, ftw: 0 });

        [spellId] = (
            await db
                .insert(spells)
                .values({
                    external_id: `advance-spell-${SUFFIX}`,
                    name: `Test Spell ${SUFFIX}`,
                    kind: 'SPELL',
                    advancement_factor: 'B',
                })
                .returning({ id: spells.id })
        ).map(row => row.id);
        await db.insert(playerSpells).values({ player_id: playerId, spell_id: spellId, ftw: 12 });

        [abilityId] = (
            await db
                .insert(actionModifications)
                .values({
                    name: `Test Ability ${SUFFIX}`,
                    prerequisites: { ge: 15 },
                    rules: { type: 'test' },
                    ap_cost: 10,
                })
                .returning({ id: actionModifications.id })
        ).map(row => row.id);

        [catalogAbilityId] = (
            await db
                .insert(specialAbilities)
                .values({
                    external_id: `advance-special-${SUFFIX}`,
                    name: `Test Magical Ability ${SUFFIX}`,
                    category: 'MAGICAL',
                    ap_cost: 5,
                    prerequisites: 'MU 13, passende Tradition',
                    requires_confirmation: true,
                })
                .returning({ id: specialAbilities.id })
        ).map(row => row.id);
        await db.insert(supernaturalProfiles).values({
            player_id: playerId,
            magical_tradition: 'Gildenmagier',
        });

        await db.update(stats).set({ mu: 12, kl: 10, in: 9, ge: 14 }).where(eq(stats.player_id, playerId));
    });

    it('validates and records AP grants in the immutable ledger', async () => {
        assert.equal((await app.request('/advancement/grant', json('POST', { amount: 0, reason: 'bad' }))).status, 400);
        const response = await app.request('/advancement/grant', json('POST', { amount: 100, reason: 'Session 1' }));
        assert.equal(response.status, 201);
        assert.equal((await response.json()).balanceAfter, 100);
        const summary = await (await app.request('/advancement')).json();
        assert.deepEqual(
            { total: summary.total, available: summary.available, spent: summary.spent },
            { total: 100, available: 100, spent: 0 }
        );
        assert.equal(summary.ledger[0].category, 'AP_GRANT');
    });

    it('raises an attribute by one with the target-value cost', async () => {
        const response = await app.request('/advancement/attributes', json('POST', { attribute: 'MU' }));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(
            { previous: result.previous, value: result.value, apSpent: result.apSpent },
            { previous: 12, value: 13, apSpent: 15 }
        );
    });

    it('raises a talent by its factor and enforces the attribute cap', async () => {
        const response = await app.request('/advancement/talents', json('POST', { talentId }));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).apSpent, 3);
        await db
            .update(playerTalents)
            .set({ ftw: 15 })
            .where(and(eq(playerTalents.player_id, playerId), eq(playerTalents.talent_id, talentId)));
        assert.equal((await app.request('/advancement/talents', json('POST', { talentId }))).status, 400);
    });

    it('raises learned supernatural FW and enforces the knowledge cap', async () => {
        const response = await app.request(
            '/advancement/supernatural',
            json('POST', { abilityType: 'SPELL', abilityId: spellId })
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).apSpent, 4);
        await db
            .update(playerSpells)
            .set({ ftw: 14 })
            .where(and(eq(playerSpells.player_id, playerId), eq(playerSpells.spell_id, spellId)));
        assert.equal(
            (await app.request('/advancement/supernatural', json('POST', { abilityType: 'SPELL', abilityId: spellId })))
                .status,
            400
        );
    });

    it('checks special-ability prerequisites and prevents duplicate spending', async () => {
        assert.equal((await app.request('/advancement/special-abilities', json('POST', { abilityId }))).status, 400);
        await db.update(stats).set({ ge: 15 }).where(eq(stats.player_id, playerId));
        const response = await app.request('/advancement/special-abilities', json('POST', { abilityId }));
        assert.equal(response.status, 201);
        assert.equal((await response.json()).apSpent, 10);
        assert.equal((await app.request('/advancement/special-abilities', json('POST', { abilityId }))).status, 409);
        const learned = await db
            .select()
            .from(playerActionModifications)
            .where(
                and(
                    eq(playerActionModifications.player_id, playerId),
                    eq(playerActionModifications.action_modification_id, abilityId)
                )
            );
        assert.equal(learned.length, 1);
    });

    it('learns source-backed non-combat abilities only after manual prerequisite confirmation', async () => {
        assert.equal(
            (
                await app.request(
                    '/advancement/special-abilities',
                    json('POST', { abilityId: catalogAbilityId, confirmedPrerequisites: false })
                )
            ).status,
            400
        );
        const response = await app.request(
            '/advancement/special-abilities',
            json('POST', { abilityId: catalogAbilityId, confirmedPrerequisites: true })
        );
        assert.equal(response.status, 201);
        assert.equal((await response.json()).apSpent, 5);
        const learned = await db
            .select()
            .from(playerSpecialAbilities)
            .where(
                and(
                    eq(playerSpecialAbilities.player_id, playerId),
                    eq(playerSpecialAbilities.special_ability_id, catalogAbilityId)
                )
            );
        assert.equal(learned.length, 1);
        const listed = await (await app.request('/advancement/special-abilities')).json();
        assert.ok(listed.catalogAbilities.some((ability: { id: string }) => ability.id === catalogAbilityId));
    });

    it('rolls back the value change when AP are insufficient', async () => {
        await db.update(stats).set({ ap_available: 0 }).where(eq(stats.player_id, playerId));
        const beforeLedger = await db.select().from(apTransactions).where(eq(apTransactions.player_id, playerId));
        assert.equal((await app.request('/advancement/attributes', json('POST', { attribute: 'KL' }))).status, 400);
        const [sheet] = await db.select().from(stats).where(eq(stats.player_id, playerId));
        const afterLedger = await db.select().from(apTransactions).where(eq(apTransactions.player_id, playerId));
        assert.equal(sheet.kl, 10);
        assert.equal(afterLedger.length, beforeLedger.length);
    });
});
