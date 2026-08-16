import 'dotenv/config';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { closeDb, db } from '../../db';
import {
    actionModifications,
    combatActions,
    combatantEffects,
    combatants,
    combatantStatuses,
    combatSessions,
    mobs,
    playerActionModifications,
    players,
    stats,
    weapons,
} from '../../db/schema';
import { beginAttackAction, resolvePendingAttack, retrieveDroppedWeapon, takeFullDefense } from '../../services/combat';

const SUFFIX = `${Date.now()}`;
const ATTACKER_DISCORD_ID = `test-maneuvers-attacker-${SUFFIX}`;
const DEFENDER_DISCORD_ID = `test-maneuvers-defender-${SUFFIX}`;
const CHANNEL_ID = `test-maneuvers-channel-${SUFFIX}`;
const MOB_NAME = `Test maneuver mob ${SUFFIX}`;
const PREFIX = `Test ${SUFFIX}`;

let attackerPlayerId: number;
let defenderPlayerId: number;
let sessionId: string;
let attackerId: string;
let defenderId: string;
let npcId: string;
let attackerWeaponId: number;
let attackerSecondWeaponId: number;
let defenderWeaponId: number;
let defenderShieldId: number;
let maneuverIds: Record<string, string>;
let createdFullDefense = false;

async function withRandom<T>(value: number, operation: () => Promise<T>): Promise<T> {
    const original = Math.random;
    Math.random = () => value;
    try {
        return await operation();
    } finally {
        Math.random = original;
    }
}

async function resolveStarted(
    started: Awaited<ReturnType<typeof beginAttackAction>>,
    decision: 'PARRY' | 'DODGE' | 'DECLINE' = 'DECLINE',
    random = 0.45
) {
    if (started.status === 'RESOLVED') return started.result;
    return withRandom(random, async () => {
        const resolved = await resolvePendingAttack(
            { discordId: DEFENDER_DISCORD_ID },
            { actionId: started.actionId, decision }
        );
        return resolved.result;
    });
}

async function beginManeuver(type: string, extra: Record<string, unknown> = {}, random = 0.45) {
    return withRandom(random, () =>
        beginAttackAction(
            { discordId: ATTACKER_DISCORD_ID },
            {
                sessionId,
                attackerId,
                targetId: defenderId,
                maneuverId: maneuverIds[type],
                ...extra,
            }
        )
    );
}

async function cleanup() {
    await db.delete(combatSessions).where(eq(combatSessions.channel_id, CHANNEL_ID));
    await db.delete(mobs).where(eq(mobs.name, MOB_NAME));
    await db.delete(players).where(inArray(players.discord_id, [ATTACKER_DISCORD_ID, DEFENDER_DISCORD_ID]));
    await db.delete(actionModifications).where(like(actionModifications.name, `${PREFIX}%`));
}

describe('combat maneuver services (live DB)', () => {
    before(async () => {
        await cleanup();
        const [attacker, defender] = await db
            .insert(players)
            .values([
                { name: `${PREFIX} attacker`, discord_id: ATTACKER_DISCORD_ID },
                { name: `${PREFIX} defender`, discord_id: DEFENDER_DISCORD_ID },
            ])
            .returning();
        attackerPlayerId = attacker.id;
        defenderPlayerId = defender.id;
        await db.insert(stats).values([
            {
                player_id: attackerPlayerId,
                mu: 20,
                in: 20,
                ge: 20,
                ff: 20,
                ko: 20,
                kk: 20,
                le_max: 100,
                le_current: 100,
                attacke_basis: 30,
                parade_basis: 15,
                ausweichen: 12,
            },
            {
                player_id: defenderPlayerId,
                mu: 20,
                in: 20,
                ge: 20,
                ff: 20,
                ko: 20,
                kk: 20,
                le_max: 100,
                le_current: 100,
                attacke_basis: 15,
                parade_basis: 30,
                ausweichen: 30,
            },
        ]);
        const insertedWeapons = await db
            .insert(weapons)
            .values([
                {
                    player_id: attackerPlayerId,
                    name: `${PREFIX} sword`,
                    type: 'MELEE',
                    combat_technique: 'Schwerter',
                    tp: '1w6+4',
                    at: 30,
                    pa: 15,
                    is_equipped: 'Y',
                    equipped_slot: 'OFFENSE',
                },
                {
                    player_id: attackerPlayerId,
                    name: `${PREFIX} off hand`,
                    type: 'MELEE',
                    combat_technique: 'Schwerter',
                    tp: '1w6',
                    at: 30,
                    pa: 15,
                    is_equipped: 'N',
                },
                {
                    player_id: defenderPlayerId,
                    name: `${PREFIX} target sword`,
                    type: 'MELEE',
                    combat_technique: 'Schwerter',
                    tp: '1w6',
                    at: 15,
                    pa: 30,
                    is_equipped: 'Y',
                    equipped_slot: 'OFFENSE',
                },
                {
                    player_id: defenderPlayerId,
                    name: `${PREFIX} target shield`,
                    type: 'MELEE',
                    combat_technique: 'Schilde',
                    tp: '1w6',
                    at: 10,
                    pa: 30,
                    shield_pa_bonus: 2,
                    is_equipped: 'N',
                },
            ])
            .returning();
        [attackerWeaponId, attackerSecondWeaponId, defenderWeaponId, defenderShieldId] = insertedWeapons.map(
            row => row.id
        );

        const insertedManeuverRows = await db
            .insert(actionModifications)
            .values([
                { name: `${PREFIX} Entwaffnen`, action_type: 'MELEE', rules: { type: 'disarm', at_modifier: -4 } },
                { name: `${PREFIX} Zu Fall bringen`, action_type: 'MELEE', rules: { type: 'trip', at_modifier: -4 } },
                { name: `${PREFIX} Haltegriff`, action_type: 'MELEE', rules: { type: 'grapple' } },
                { name: `${PREFIX} Gezielter Angriff`, action_type: 'MELEE', rules: { type: 'called_shot' } },
                { name: `${PREFIX} Wuchtschlag`, action_type: 'MELEE', rules: { type: 'power_attack' } },
                {
                    name: `${PREFIX} Sturmangriff`,
                    action_type: 'MELEE',
                    prerequisites: { requires: `${PREFIX} Wuchtschlag` },
                    rules: { type: 'charge', at_modifier: -2 },
                },
            ])
            .returning();
        let [fullDefense] = await db
            .select()
            .from(actionModifications)
            .where(eq(actionModifications.name, 'Verteidigungshaltung'))
            .limit(1);
        if (!fullDefense) {
            [fullDefense] = await db
                .insert(actionModifications)
                .values({
                    name: 'Verteidigungshaltung',
                    action_type: 'MELEE',
                    rules: { type: 'full_defense', pa_modifier: 4 },
                })
                .returning();
            createdFullDefense = true;
        }
        const maneuverRows = [...insertedManeuverRows, fullDefense];
        maneuverIds = Object.fromEntries(
            maneuverRows.map(row => [String((row.rules as { type?: string })?.type ?? row.name), row.id])
        );
        await db
            .insert(playerActionModifications)
            .values(maneuverRows.map(row => ({ player_id: attackerPlayerId, action_modification_id: row.id })));

        const [mob] = await db
            .insert(mobs)
            .values({
                name: MOB_NAME,
                base_max_hp: 100,
                base_initiative: 5,
                base_attack_value: 10,
                base_parry_value: 10,
                base_armor_soak: 0,
                base_damage_tp: '1w6',
            })
            .returning();
        const [session] = await db
            .insert(combatSessions)
            .values({ channel_id: CHANNEL_ID, dm_user_id: ATTACKER_DISCORD_ID, state: 'RUNNING', current_round: 1 })
            .returning();
        sessionId = session.id;
        const rows = await db
            .insert(combatants)
            .values([
                {
                    session_id: sessionId,
                    type: 'PLAYER',
                    allegiance: 'PLAYER_SIDE',
                    player_id: attackerPlayerId,
                    discord_user_id: ATTACKER_DISCORD_ID,
                    name: `${PREFIX} attacker`,
                    max_hp: 100,
                    current_hp: 100,
                    wound_threshold: 100,
                    initiative_base: 20,
                    movement_speed: 8,
                },
                {
                    session_id: sessionId,
                    type: 'PLAYER',
                    allegiance: 'HOSTILE',
                    player_id: defenderPlayerId,
                    discord_user_id: DEFENDER_DISCORD_ID,
                    name: `${PREFIX} defender`,
                    max_hp: 100,
                    current_hp: 100,
                    wound_threshold: 100,
                    initiative_base: 10,
                    movement_speed: 8,
                },
                {
                    session_id: sessionId,
                    type: 'NPC',
                    allegiance: 'HOSTILE',
                    mob_definition_id: mob.id,
                    name: MOB_NAME,
                    max_hp: 100,
                    current_hp: 100,
                    wound_threshold: 100,
                    initiative_base: 5,
                },
            ])
            .returning();
        [attackerId, defenderId, npcId] = rows.map(row => row.id);
    });

    beforeEach(async () => {
        const ids = [attackerId, defenderId, npcId];
        await db.delete(combatActions).where(eq(combatActions.session_id, sessionId));
        await db.delete(combatantEffects).where(inArray(combatantEffects.combatant_id, ids));
        await db.delete(combatantStatuses).where(inArray(combatantStatuses.combatant_id, ids));
        await db
            .update(combatants)
            .set({
                current_hp: 100,
                wounds: 0,
                defense_count: 0,
                action_spent: false,
                free_action_spent: false,
                ongoing_action: null,
            })
            .where(inArray(combatants.id, ids));
        await db
            .update(combatSessions)
            .set({ turn_order: [attackerId, defenderId, npcId], current_turn_index: 0, combat_log: [] })
            .where(eq(combatSessions.id, sessionId));
        await db.update(stats).set({ attacke_basis: 30 }).where(eq(stats.player_id, attackerPlayerId));
        await db
            .update(weapons)
            .set({
                is_equipped: 'N',
                equipped_slot: null,
                is_dropped: false,
                dropped_session_id: null,
                dropped_at: null,
            })
            .where(inArray(weapons.id, [attackerWeaponId, attackerSecondWeaponId, defenderWeaponId, defenderShieldId]));
        await db
            .update(weapons)
            .set({ is_equipped: 'Y', equipped_slot: 'OFFENSE', at: 30 })
            .where(eq(weapons.id, attackerWeaponId));
        await db
            .update(weapons)
            .set({ is_equipped: 'Y', equipped_slot: 'OFFENSE' })
            .where(eq(weapons.id, defenderWeaponId));
    });

    after(async () => {
        await db.execute(sql.raw('DROP TRIGGER IF EXISTS codex_fail_combat_log ON combat_sessions'));
        await db.execute(sql.raw('DROP FUNCTION IF EXISTS codex_fail_combat_log()'));
        await cleanup();
        if (createdFullDefense) {
            await db.delete(actionModifications).where(eq(actionModifications.name, 'Verteidigungshaltung'));
        }
        await closeDb();
    });

    it('Entwaffnen applies AT -4, deals 1W3, and persists the dropped weapon', async () => {
        const result = await resolveStarted(await beginManeuver('disarm'));
        assert.equal(result.atValue, 26);
        assert.ok(result.rolledDamage >= 1 && result.rolledDamage <= 3);
        assert.ok(result.appliedEffects.includes('disarmed'));
        const [weapon] = await db.select().from(weapons).where(eq(weapons.id, defenderWeaponId));
        assert.equal(weapon.is_equipped, 'N');
        assert.equal(weapon.is_dropped, true);
        assert.equal(weapon.dropped_session_id, sessionId);
    });

    it('Entwaffnen leaves equipment unchanged after a failed attack or successful defense', async () => {
        await db.update(weapons).set({ at: 0 }).where(eq(weapons.id, attackerWeaponId));
        const missed = await resolveStarted(await beginManeuver('disarm', {}, 0.45));
        assert.equal(missed.attack.outcome, 'NORMAL_MISS');
        assert.equal((await db.select().from(weapons).where(eq(weapons.id, defenderWeaponId)))[0].is_dropped, false);

        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
        await db.update(weapons).set({ at: 30 }).where(eq(weapons.id, attackerWeaponId));
        const defended = await resolveStarted(await beginManeuver('disarm'), 'PARRY', 0);
        assert.equal(defended.defense?.success, true);
        assert.equal(defended.hitConnected, false);
        assert.equal((await db.select().from(weapons).where(eq(weapons.id, defenderWeaponId)))[0].is_dropped, false);
    });

    it('Entwaffnen rejects shields and targets without a droppable weapon without spending the action', async () => {
        await db.update(weapons).set({ is_equipped: 'N', equipped_slot: null }).where(eq(weapons.id, defenderWeaponId));
        await db
            .update(weapons)
            .set({ is_equipped: 'Y', equipped_slot: 'OFFENSE' })
            .where(eq(weapons.id, defenderShieldId));
        await assert.rejects(() => beginManeuver('disarm'), /cannot disarm a shield/);
        assert.equal((await db.select().from(combatants).where(eq(combatants.id, attackerId)))[0].action_spent, false);
        await assert.rejects(
            () =>
                withRandom(0.45, () =>
                    beginAttackAction(
                        { discordId: ATTACKER_DISCORD_ID },
                        { sessionId, attackerId, targetId: npcId, maneuverId: maneuverIds.disarm }
                    )
                ),
            /requires a target with a weapon/
        );
        assert.equal((await db.select().from(combatants).where(eq(combatants.id, attackerId)))[0].action_spent, false);
    });

    it('rolls the maneuver, dropped state, action claim, and logs back together on database failure', async () => {
        const started = await beginManeuver('disarm');
        assert.equal(started.status, 'PENDING');
        await db.execute(
            sql.raw(`
            CREATE FUNCTION codex_fail_combat_log() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.combat_log IS DISTINCT FROM OLD.combat_log THEN
                    RAISE EXCEPTION 'forced combat log failure';
                END IF;
                RETURN NEW;
            END
            $$
        `)
        );
        await db.execute(
            sql.raw(`
            CREATE TRIGGER codex_fail_combat_log
            BEFORE UPDATE ON combat_sessions
            FOR EACH ROW EXECUTE FUNCTION codex_fail_combat_log()
        `)
        );
        try {
            await assert.rejects(
                () =>
                    resolvePendingAttack(
                        { discordId: DEFENDER_DISCORD_ID },
                        { actionId: started.actionId, decision: 'DECLINE' }
                    ),
                /forced combat log failure/
            );
        } finally {
            await db.execute(sql.raw('DROP TRIGGER codex_fail_combat_log ON combat_sessions'));
            await db.execute(sql.raw('DROP FUNCTION codex_fail_combat_log()'));
        }
        const [weapon] = await db.select().from(weapons).where(eq(weapons.id, defenderWeaponId));
        const [action] = await db.select().from(combatActions).where(eq(combatActions.id, started.actionId));
        assert.equal(weapon.is_dropped, false);
        assert.equal(weapon.is_equipped, 'Y');
        assert.equal(action.status, 'PENDING');
    });

    it('applies trip, grapple, called-shot, charge-failure, and opportunity consequences', async () => {
        const trip = await resolveStarted(await beginManeuver('trip'));
        assert.ok(trip.appliedEffects.includes('liegend'));
        assert.ok(
            (await db.select().from(combatantStatuses).where(eq(combatantStatuses.combatant_id, defenderId))).some(
                row => row.status_type === 'liegend'
            )
        );

        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
        await db.delete(combatantStatuses).where(eq(combatantStatuses.combatant_id, defenderId));
        await db.update(weapons).set({ is_equipped: 'N', equipped_slot: null }).where(eq(weapons.id, attackerWeaponId));
        const grapple = await resolveStarted(await beginManeuver('grapple'));
        assert.ok(grapple.appliedEffects.includes('fixiert'));
        assert.ok(grapple.appliedEffects.includes('eingeengt'));
        assert.ok(grapple.appliedEffects.includes('grappling'));

        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
        await db
            .update(weapons)
            .set({ is_equipped: 'Y', equipped_slot: 'OFFENSE', at: 30 })
            .where(eq(weapons.id, attackerWeaponId));
        const calledShot = await resolveStarted(await beginManeuver('called_shot', { hitZone: 'head' }));
        assert.equal(calledShot.atValue, 25);
        assert.equal(calledShot.hitZone, 'head');

        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, attackerId));
        await db.update(weapons).set({ at: 0 }).where(eq(weapons.id, attackerWeaponId));
        const charge = await resolveStarted(await beginManeuver('charge', { distance: 4 }));
        assert.equal(charge.attack.outcome, 'NORMAL_MISS');
        assert.equal(charge.opportunityGranted, true);
        assert.ok(
            (await db.select().from(combatantEffects).where(eq(combatantEffects.combatant_id, defenderId))).some(
                row => row.effect_type === `opportunity:${attackerId}`
            )
        );

        await db.update(weapons).set({ at: 30 }).where(eq(weapons.id, attackerWeaponId));
        const opportunity = await withRandom(0.45, () =>
            beginAttackAction(
                { discordId: DEFENDER_DISCORD_ID },
                { sessionId, attackerId: defenderId, targetId: attackerId, attackKind: 'opportunity' }
            )
        );
        assert.equal(opportunity.status, 'RESOLVED');
        assert.equal(opportunity.result.defense, null);
        assert.equal(
            (
                await db
                    .select()
                    .from(combatantEffects)
                    .where(
                        and(
                            eq(combatantEffects.combatant_id, defenderId),
                            eq(combatantEffects.effect_type, `opportunity:${attackerId}`)
                        )
                    )
            ).length,
            0
        );
    });

    it('enforces first-declaration full defense and persists the +4 PA stance', async () => {
        const effect = await takeFullDefense(
            { discordId: ATTACKER_DISCORD_ID },
            { sessionId, combatantId: attackerId }
        );
        assert.equal(effect.pa_modifier, 4);
        assert.equal(effect.prohibits_actions, true);
        assert.equal((await db.select().from(combatants).where(eq(combatants.id, attackerId)))[0].action_spent, true);
        await assert.rejects(
            () => takeFullDefense({ discordId: ATTACKER_DISCORD_ID }, { sessionId, combatantId: attackerId }),
            /barred from acting|already spent/
        );
    });

    it('retrieves dropped weapons on success and grants an opportunity after failure', async () => {
        await db
            .update(weapons)
            .set({ is_equipped: 'N', equipped_slot: null, is_dropped: true, dropped_session_id: sessionId })
            .where(eq(weapons.id, defenderWeaponId));
        await db
            .update(combatSessions)
            .set({ turn_order: [defenderId, attackerId, npcId], current_turn_index: 0 })
            .where(eq(combatSessions.id, sessionId));
        const success = await withRandom(0, () =>
            retrieveDroppedWeapon(
                { discordId: DEFENDER_DISCORD_ID },
                { sessionId, combatantId: defenderId, weaponId: defenderWeaponId, opponentId: attackerId }
            )
        );
        assert.equal(success.success, true);
        assert.equal((await db.select().from(weapons).where(eq(weapons.id, defenderWeaponId)))[0].is_dropped, false);

        await db.update(combatants).set({ action_spent: false }).where(eq(combatants.id, defenderId));
        await db
            .update(weapons)
            .set({ is_dropped: true, dropped_session_id: sessionId })
            .where(eq(weapons.id, defenderWeaponId));
        await db.update(stats).set({ ge: 0, ko: 0 }).where(eq(stats.player_id, defenderPlayerId));
        const failure = await withRandom(0.95, () =>
            retrieveDroppedWeapon(
                { discordId: DEFENDER_DISCORD_ID },
                { sessionId, combatantId: defenderId, weaponId: defenderWeaponId, opponentId: attackerId }
            )
        );
        assert.equal(failure.success, false);
        assert.equal(failure.opportunityGrantedTo, attackerId);
        assert.ok(
            (await db.select().from(combatantEffects).where(eq(combatantEffects.combatant_id, attackerId))).some(
                row => row.effect_type === `opportunity:${defenderId}`
            )
        );
    });
});
