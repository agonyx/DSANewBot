import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { db, closeDb } from '../../db';
import { combatSessions, combatants, mobs, players, stats } from '../../db/schema';
import { eq } from 'drizzle-orm';

const TEST_DISCORD_ID = `test-api-cbt-${Date.now()}`;
const MOB_NAME = `Test Combat Mob ${Date.now()}`;
const CHANNEL = `test-channel-${Date.now()}`;
const app = createApiApp({ resolveCtx: async () => ({ discordId: TEST_DISCORD_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});
const setStat = (statKey: string, value: number) => app.request('/characters/stats', json('PATCH', { statKey, value }));

async function attackAndDecide(
    sessionId: string,
    body: { attackerId: string; targetId: string },
    decision: 'PARRY' | 'DODGE' | 'DECLINE' = 'DECLINE'
) {
    const started = await (await app.request(`/combat/${sessionId}/attack`, json('POST', body))).json();
    if (started.status === 'PENDING') {
        const resolved = await (
            await app.request(
                `/combat/${sessionId}/pending-attack/${started.pending.id}/defense`,
                json('POST', { decision })
            )
        ).json();
        return resolved.result;
    }
    return started.result;
}

const OUTCOMES = new Set(['CRITICAL_SUCCESS', 'NORMAL_HIT', 'NORMAL_MISS', 'BOTCH']);

describe('combat API (live DB)', () => {
    let sessionId: string;
    let playerId: number;
    let mobId: number;
    let playerCombatantId: string;
    let npcCombatantId: string;

    after(async () => {
        await db.delete(combatSessions).where(eq(combatSessions.dm_user_id, TEST_DISCORD_ID));
        await db.delete(mobs).where(eq(mobs.name, MOB_NAME));
        await db.delete(players).where(eq(players.discord_id, TEST_DISCORD_ID));
        await closeDb();
    });

    it('setup: player + mob + session + two combatants', async () => {
        // Player character with combat stats (no weapon → falls back to attacke_basis / parade_basis)
        const cr = await (await app.request('/characters', json('POST', { name: 'Combat Tester' }))).json();
        playerId = cr.player.id;
        await app.request(`/characters/${playerId}/select`, { method: 'POST' });
        for (const [k, v] of [
            ['le_max', 100],
            ['le_current', 100],
            ['initiative', 10],
            ['ko', 14],
            ['attacke_basis', 12],
            ['parade_basis', 8],
            ['ruestungsschutz', 2],
        ] as [string, number][]) {
            await setStat(k, v);
        }

        // Mob template
        const mob = await (
            await app.request(
                '/mobs',
                json('POST', {
                    name: MOB_NAME,
                    base_max_hp: 100,
                    base_initiative: 8,
                    base_attack_value: 12,
                    base_parry_value: 6,
                    base_armor_soak: 1,
                    base_damage_tp: '1w6+2',
                })
            )
        ).json();
        mobId = mob.id;

        // Session
        const sess = await (
            await app.request('/combat', json('POST', { channelId: CHANNEL, dmUserId: TEST_DISCORD_ID }))
        ).json();
        sessionId = sess.id;
        assert.equal(sess.state, 'SETUP');

        const pc = await (
            await app.request(
                `/combat/${sessionId}/combatants`,
                json('POST', {
                    type: 'PLAYER',
                    allegiance: 'PLAYER_SIDE',
                    playerId,
                    discordUserId: TEST_DISCORD_ID,
                    name: 'Combat Tester',
                    maxHp: 100,
                    currentHp: 100,
                    initiativeBase: 10,
                })
            )
        ).json();
        playerCombatantId = pc.id;
        assert.equal(pc.wounds, 0);
        assert.equal(pc.wound_threshold, 7);

        const nc = await (
            await app.request(
                `/combat/${sessionId}/combatants`,
                json('POST', {
                    type: 'NPC',
                    allegiance: 'HOSTILE',
                    mobDefinitionId: mobId,
                    name: MOB_NAME,
                    maxHp: 100,
                    currentHp: 100,
                    wounds: 0,
                    woundThreshold: 5,
                    initiativeBase: 8,
                })
            )
        ).json();
        npcCombatantId = nc.id;
        assert.equal(nc.wound_threshold, 5);
    });

    it('begin → RUNNING with a 2-entry turn order', async () => {
        const r = await (await app.request(`/combat/${sessionId}/begin`, { method: 'POST' })).json();
        assert.equal(r.state, 'RUNNING');
        assert.equal(r.turn_order.length, 2);
        assert.ok(r.current_round >= 1);
    });

    it('attack by the active combatant → well-formed result', async () => {
        const st = await (await app.request(`/combat/${sessionId}`)).json();
        const activeId = st.session.turn_order[st.session.current_turn_index];
        const target = st.combatants.find((c: { id: string }) => c.id !== activeId);

        const r = await attackAndDecide(sessionId, { attackerId: activeId, targetId: target.id });
        assert.ok(OUTCOMES.has(r.attack.outcome));
        assert.ok(Number.isInteger(r.attackerHpAfter) && r.attackerHpAfter <= r.attackerHpBefore);
        assert.ok(Number.isInteger(r.targetHpAfter) && r.targetHpAfter <= r.targetHpBefore);
        assert.ok(r.attackerWoundsAfter >= r.attackerWoundsBefore);
        assert.ok(r.targetWoundsAfter >= r.targetWoundsBefore);
        if (r.hitConnected) {
            assert.ok(r.finalDamage >= 0);
            assert.ok(r.targetHpAfter < r.targetHpBefore || r.finalDamage === 0);
        }
        assert.ok(typeof r.logMessage === 'string' && r.logMessage.length > 0);
    });

    it('persists a pending defense without damage and resolves duplicate decisions idempotently', async () => {
        await db
            .update(combatants)
            .set({ current_hp: 500, max_hp: 500, wound_threshold: 500, wounds: 0, action_spent: false })
            .where(eq(combatants.session_id, sessionId));
        await db
            .update(stats)
            .set({ le_current: 500, le_max: 500, attacke_basis: 30 })
            .where(eq(stats.player_id, playerId));
        await db.update(mobs).set({ base_attack_value: 30 }).where(eq(mobs.id, mobId));
        const state = await (await app.request(`/combat/${sessionId}`)).json();
        const attackerId = state.session.turn_order[state.session.current_turn_index];
        const target = state.combatants.find((combatant: { id: string }) => combatant.id !== attackerId);
        let pending: any = null;
        for (let attempt = 0; attempt < 10 && !pending; attempt += 1) {
            const started = await (
                await app.request(`/combat/${sessionId}/attack`, json('POST', { attackerId, targetId: target.id }))
            ).json();
            if (started.status === 'PENDING') pending = started.pending;
            else {
                await db
                    .update(combatants)
                    .set({ action_spent: false, current_hp: 500, wounds: 0 })
                    .where(eq(combatants.session_id, sessionId));
                await db.update(stats).set({ le_current: 500, wounds: 0 }).where(eq(stats.player_id, playerId));
            }
        }
        assert.ok(pending, 'expected a normal hit to produce a pending defense');
        const before = await (await app.request(`/combat/${sessionId}`)).json();
        const targetBefore = before.combatants.find((row: { id: string }) => row.id === target.id);
        assert.equal(targetBefore.current_hp, 500);
        const recovered = await (await app.request(`/combat/${sessionId}/pending-attack/${pending.id}`)).json();
        assert.equal(recovered.id, pending.id, 'durable lookup must recover the prompt without in-memory state');
        const unauthorized = createApiApp({ resolveCtx: async () => ({ discordId: 'not-the-defender' }) });
        assert.equal(
            (
                await unauthorized.request(
                    `/combat/${sessionId}/pending-attack/${pending.id}/defense`,
                    json('POST', { decision: 'DECLINE' })
                )
            ).status,
            403
        );
        const decisions = await Promise.all(
            [0, 1].map(async () =>
                (
                    await app.request(
                        `/combat/${sessionId}/pending-attack/${pending.id}/defense`,
                        json('POST', { decision: 'DECLINE' })
                    )
                ).json()
            )
        );
        const first = decisions.find(result => result.alreadyResolved === false);
        const duplicate = decisions.find(result => result.alreadyResolved === true);
        assert.ok(first);
        assert.ok(duplicate);
        assert.equal(first.alreadyResolved, false);
        assert.equal(duplicate.alreadyResolved, true);
        assert.equal(duplicate.result.targetHpAfter, first.result.targetHpAfter);
        const after = await (await app.request(`/combat/${sessionId}`)).json();
        assert.equal(
            after.combatants.find((row: { id: string }) => row.id === target.id).current_hp,
            first.result.targetHpAfter
        );
        assert.equal(
            after.combatants.find((row: { id: string }) => row.id === target.id).defense_count,
            targetBefore.defense_count,
            'declining must not spend a defense'
        );
        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
    });

    it('interrupts a persisted longer action only when a defense is attempted', async () => {
        const state = await (await app.request(`/combat/${sessionId}`)).json();
        const attackerId = state.session.turn_order[state.session.current_turn_index];
        const target = state.combatants.find((combatant: { id: string }) => combatant.id !== attackerId);
        await db
            .update(combatants)
            .set({
                action_spent: false,
                current_hp: 500,
                wounds: 0,
                defense_count: 0,
                ongoing_action: { type: 'SPELL', label: 'Test ritual' },
            })
            .where(eq(combatants.id, target.id));
        let pending: any = null;
        for (let attempt = 0; attempt < 10 && !pending; attempt += 1) {
            const started = await (
                await app.request(`/combat/${sessionId}/attack`, json('POST', { attackerId, targetId: target.id }))
            ).json();
            if (started.status === 'PENDING') pending = started.pending;
            else await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
        }
        assert.ok(pending, 'expected a defense prompt with the high test attack value');
        const choice = pending.defenseOptions.find(
            (option: { choice: string; available: boolean }) => option.choice !== 'DECLINE' && option.available
        )?.choice;
        assert.ok(choice);
        const resolved = await (
            await app.request(
                `/combat/${sessionId}/pending-attack/${pending.id}/defense`,
                json('POST', { decision: choice })
            )
        ).json();
        assert.equal(resolved.result.defense.interruptedLongAction, true);
        const fresh = await (await app.request(`/combat/${sessionId}`)).json();
        const updatedTarget = fresh.combatants.find((combatant: { id: string }) => combatant.id === target.id);
        assert.equal(updatedTarget.ongoing_action, null);
        assert.equal(updatedTarget.defense_count, 1);
        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
    });

    it('applies the cumulative multiple-defense penalty within a round', async () => {
        await db
            .update(combatants)
            .set({
                current_hp: 500,
                max_hp: 500,
                wound_threshold: 500,
                wounds: 0,
                defense_count: 0,
                action_spent: false,
            })
            .where(eq(combatants.session_id, sessionId));
        await db
            .update(stats)
            .set({ le_current: 500, le_max: 500, wounds: 0, attacke_basis: 30 })
            .where(eq(stats.player_id, playerId));
        await db.update(mobs).set({ base_attack_value: 30 }).where(eq(mobs.id, mobId));

        const state = await (await app.request(`/combat/${sessionId}`)).json();
        const activeId = state.session.turn_order[state.session.current_turn_index];
        const targetId = state.combatants.find((combatant: { id: string }) => combatant.id !== activeId).id;
        const defended = [];
        for (let attempt = 0; attempt < 8 && defended.length < 2; attempt += 1) {
            const result = await attackAndDecide(sessionId, { attackerId: activeId, targetId }, 'PARRY');
            if (result.defense) defended.push(result);
            await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, activeId));
        }
        assert.equal(defended.length, 2, 'expected two defense attempts with high AT before wound incapacity');
        assert.equal(defended[0].defensePenalty, 0);
        assert.equal(defended[1].defenseCountBefore, 1);
        assert.equal(defended[1].defensePenalty, 3);
    });

    it('attack out of turn → 400', async () => {
        // The NPC is not the active combatant right after the player's turn advanced? Probe with the
        // non-active id; regardless of who is active, attacking the WRONG attacker id errors.
        const st = await (await app.request(`/combat/${sessionId}`)).json();
        const activeId = st.session.turn_order[st.session.current_turn_index];
        const other = st.combatants.find((c: { id: string }) => c.id !== activeId);
        const r = await app.request(
            `/combat/${sessionId}/attack`,
            json('POST', { attackerId: other.id, targetId: activeId })
        );
        assert.equal(r.status, 400);
    });

    it('advance → not ended (both sides still standing)', async () => {
        const r = await (await app.request(`/combat/${sessionId}/advance`, { method: 'POST' })).json();
        assert.equal(r.ended, false);
    });

    it('conditions: apply / list / remove on the NPC combatant', async () => {
        const apply = await (
            await app.request(
                `/combat/combatants/${npcCombatantId}/conditions`,
                json('POST', {
                    conditionType: 'betaeubung',
                    level: 2,
                    source: 'test',
                })
            )
        ).json();
        assert.equal(apply.level, 2);

        const list = await (await app.request(`/combat/combatants/${npcCombatantId}/conditions`)).json();
        assert.ok(list.some((c: { condition_type: string }) => c.condition_type === 'betaeubung'));

        await app.request(`/combat/combatants/${npcCombatantId}/conditions/betaeubung`, { method: 'DELETE' });
        const after = await (await app.request(`/combat/combatants/${npcCombatantId}/conditions`)).json();
        assert.equal(after.filter((c: { condition_type: string }) => c.condition_type === 'betaeubung').length, 0);
    });

    it('condition level out of range → 400', async () => {
        const r = await app.request(
            `/combat/combatants/${npcCombatantId}/conditions`,
            json('POST', { conditionType: 'furcht', level: 9 })
        );
        assert.equal(r.status, 400);
    });

    it('ticks typed DOT and finite status duration at turn end', async () => {
        const before = await (await app.request(`/combat/${sessionId}`)).json();
        const activeId = before.session.turn_order[before.session.current_turn_index];
        const active = before.combatants.find((combatant: { id: string }) => combatant.id === activeId);
        const applied = await app.request(
            `/combat/combatants/${activeId}/statuses`,
            json('POST', {
                statusType: 'vergiftet',
                source: 'test poison',
                durationRounds: 1,
                effectData: { damagePerRound: 2, checkPenalty: 1 },
            })
        );
        assert.equal(applied.status, 201);
        const disease = await app.request(
            `/combat/combatants/${activeId}/statuses`,
            json('POST', {
                statusType: 'krank',
                source: 'test disease',
                durationRounds: 2,
                effectData: { damagePerRound: 1, damageProgressionPerRound: 2, maxDamagePerRound: 4 },
            })
        );
        assert.equal(disease.status, 201);

        const advanced = await (await app.request(`/combat/${sessionId}/advance`, { method: 'POST' })).json();
        const after = advanced.combatants.find((combatant: { id: string }) => combatant.id === activeId);
        assert.equal(after.current_hp, active.current_hp - 3);
        assert.equal(
            after.statuses.some((status: { status_type: string }) => status.status_type === 'vergiftet'),
            false
        );
        const progressedDisease = after.statuses.find(
            (status: { status_type: string }) => status.status_type === 'krank'
        );
        assert.equal(progressedDisease.effect_data.damagePerRound, 3);
        assert.equal(progressedDisease.duration_rounds, 1);
        await app.request(`/combat/combatants/${activeId}/statuses/krank`, { method: 'DELETE' });
    });

    it('persists and authorizes generic combat effects', async () => {
        const applied = await app.request(
            `/combat/combatants/${npcCombatantId}/effects`,
            json('POST', { effectType: 'test-blessing', atModifier: 2, durationRounds: 2 })
        );
        assert.equal(applied.status, 201);
        const listed = await (await app.request(`/combat/combatants/${npcCombatantId}/effects`)).json();
        assert.equal(
            listed.find((effect: { effect_type: string }) => effect.effect_type === 'test-blessing').at_modifier,
            2
        );

        const other = createApiApp({ resolveCtx: async () => ({ discordId: 'not-the-combat-dm' }) });
        const forbidden = await other.request(
            `/combat/combatants/${npcCombatantId}/effects`,
            json('POST', { effectType: 'unauthorized', paModifier: 1 })
        );
        assert.equal(forbidden.status, 403);
        assert.equal(
            (await app.request(`/combat/combatants/${npcCombatantId}/effects/test-blessing`, { method: 'DELETE' }))
                .status,
            200
        );
    });

    it('resolves two equipped one-handed weapons as one compound action', async () => {
        await app.request(
            '/weapons',
            json('POST', {
                name: 'Main-hand test sword',
                type: 'MELEE',
                combatTechnique: 'Schwerter',
                tp: '1w6+1',
                at: 30,
                pa: 8,
                is_equipped: 'Y',
                equipped_slot: 'OFFENSE',
            })
        );
        await app.request(
            '/weapons',
            json('POST', {
                name: 'Off-hand test sword',
                type: 'MELEE',
                combatTechnique: 'Schwerter',
                tp: '1w6',
                at: 30,
                pa: 8,
                is_equipped: 'Y',
                equipped_slot: 'DEFENSE',
            })
        );
        await db
            .update(combatSessions)
            .set({ turn_order: [playerCombatantId, npcCombatantId], current_turn_index: 0 })
            .where(eq(combatSessions.id, sessionId));
        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, playerCombatantId));

        const response = await app.request(
            `/combat/${sessionId}/two-weapon-attack`,
            json('POST', { attackerId: playerCombatantId, targetIds: [npcCombatantId] })
        );
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.penalty, -2);
        assert.equal(result.offHandPenalty, -6);
        const resolvedAttacks = [...result.attacks];
        let pending = result.pending;
        while (pending) {
            const decision = await (
                await app.request(
                    `/combat/${sessionId}/pending-attack/${pending.id}/defense`,
                    json('POST', { decision: 'DECLINE' })
                )
            ).json();
            resolvedAttacks.push(decision.result);
            if (decision.nextAttack?.status === 'RESOLVED') {
                resolvedAttacks.push(decision.nextAttack.result);
                pending = null;
            } else {
                pending = decision.nextAttack?.pending ?? null;
            }
        }
        assert.ok(resolvedAttacks.length === 1 || resolvedAttacks.length === 2);
        assert.equal(resolvedAttacks[0].atValue, 28);
        if (!result.secondAttackSkipped && resolvedAttacks.length === 2) assert.equal(resolvedAttacks[1].atValue, 24);
    });

    it('end → ENDED', async () => {
        const r = await (await app.request(`/combat/${sessionId}/end`, json('POST', { reason: 'test done' }))).json();
        assert.equal(r.state, 'ENDED');
        const combatLog = await (await app.request(`/combat/log?channelId=${encodeURIComponent(CHANNEL)}`)).json();
        assert.equal(combatLog.id, sessionId);
        assert.ok(Array.isArray(combatLog.log) && combatLog.log.length > 0);
    });

    it('non-DM cannot begin a session → 403', async () => {
        const other = createApiApp({ resolveCtx: async () => ({ discordId: 'someone-else' }) });
        const sess = await (
            await app.request('/combat', json('POST', { channelId: `${CHANNEL}-dm`, dmUserId: TEST_DISCORD_ID }))
        ).json();
        const r = await other.request(`/combat/${sess.id}/begin`, { method: 'POST' });
        assert.equal(r.status, 403);
        await app.request(`/combat/${sess.id}`, { method: 'DELETE' }); // cleanup (SETUP cancel)
    });

    it('prevents DM impersonation and non-DM combatant setup', async () => {
        const other = createApiApp({ resolveCtx: async () => ({ discordId: 'someone-else' }) });
        const impersonation = await other.request(
            '/combat',
            json('POST', { channelId: `${CHANNEL}-impersonation`, dmUserId: TEST_DISCORD_ID })
        );
        assert.equal(impersonation.status, 403);

        const sess = await (
            await app.request(
                '/combat',
                json('POST', { channelId: `${CHANNEL}-setup-auth`, dmUserId: TEST_DISCORD_ID })
            )
        ).json();
        const forbidden = await other.request(
            `/combat/${sess.id}/combatants`,
            json('POST', {
                type: 'NPC',
                allegiance: 'HOSTILE',
                mobDefinitionId: mobId,
                name: 'Unauthorized NPC',
                maxHp: 10,
                currentHp: 10,
            })
        );
        assert.equal(forbidden.status, 403);
        await app.request(`/combat/${sess.id}`, { method: 'DELETE' });
    });
});
