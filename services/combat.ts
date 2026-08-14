/**
 * Combat services — transactional, sessionId-keyed combat resolution over the
 * `combat_sessions` / `combatants` tables. The DB is the source of truth (the
 * Discord bot keeps an in-memory mirror for fast display; these services don't
 * depend on it). Pure resolution math (resolveAttack/resolveDefense/applySoak/
 * parseAndRollDamage) is reused from utils/combatUtils.
 *
 * Authorization: begin/end/park/resume/cancel require ctx.discordId to be the
 * session DM. Attack resolution requires the attacker to hold the active turn.
 * Throws HttpError on business failures. No discord.js, no HTTP.
 *
 * Conditions, statuses, stances, and numeric effects are persisted and folded
 * into the same resolution path used by Discord and the HTTP API.
 */
import { db } from '../db';
import { eq, and, desc, inArray, like, sql } from 'drizzle-orm';
import {
    combatSessions,
    combatants,
    combatantConditions,
    stats,
    weapons,
    mobs,
    actionModifications,
    playerActionModifications,
    playerTalents,
    talents,
    combatantEffects,
    combatantStatuses,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    startCombat as startCombatOp,
    endCombat as endCombatOp,
    createCombatant as createCombatantOp,
} from '../db/operations';
import { resolveAttack, resolveDefense, applySoak, parseAndRollDamage, rollDice } from '../utils/combatUtils';
import {
    applyWoundDamage,
    calculateWoundPenalty,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} from '../utils/woundUtils';
import {
    getCalledShotPenalty,
    getMultipleDefensePenalty,
    getRangePenalty,
    getTwoWeaponPenalties,
    resolveHumanoidHitZone,
    type CreatureSize,
    type HitZone,
    type RangeBand,
} from '../utils/combatEffectUtils';
import type { Ctx } from './_ctx';
import { getCombatantModifiers, loadEffectsForCombatants, processTurnEnd, processTurnStart } from './combatEffects';

const MAX_LOG = 20;

type SessionRow = typeof combatSessions.$inferSelect;
type CombatantRow = typeof combatants.$inferSelect;

export interface CombatState {
    session: SessionRow;
    combatants: Array<
        CombatantRow & {
            conditions?: unknown[];
            statuses?: unknown[];
            effects?: unknown[];
        }
    >;
}

async function loadSession(sessionId: string): Promise<CombatState> {
    const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId));
    if (!session) throw httpError(404, 'Combat session not found');
    const rows = await db.select().from(combatants).where(eq(combatants.session_id, sessionId));
    const effectState = await loadEffectsForCombatants(rows.map(row => row.id));
    return {
        session,
        combatants: rows.map(row => ({
            ...row,
            conditions: effectState.get(row.id)?.conditions ?? [],
            statuses: effectState.get(row.id)?.statuses ?? [],
            effects: effectState.get(row.id)?.effects ?? [],
        })),
    };
}

/** Public read accessor: full session + combatants. ctx-authority not enforced (read-only). */
export async function getCombatSession(_ctx: Ctx, sessionId: string): Promise<CombatState> {
    return loadSession(sessionId);
}

export async function getCombatLog(_ctx: Ctx, input: { sessionId?: string | null; channelId?: string | null }) {
    if (!input.sessionId && !input.channelId) throw httpError(400, 'sessionId or channelId is required');
    const rows = await db
        .select({
            id: combatSessions.id,
            state: combatSessions.state,
            round: combatSessions.current_round,
            log: combatSessions.combat_log,
            createdAt: combatSessions.created_at,
            updatedAt: combatSessions.updated_at,
        })
        .from(combatSessions)
        .where(
            input.sessionId ? eq(combatSessions.id, input.sessionId) : eq(combatSessions.channel_id, input.channelId!)
        )
        .orderBy(desc(combatSessions.updated_at))
        .limit(1);
    if (!rows[0]) throw httpError(404, 'Combat log not found');
    return rows[0];
}

function assertDm(session: SessionRow, ctx: Ctx) {
    if (session.dm_user_id !== ctx.discordId) throw httpError(403, 'Only the DM can perform this action');
}

async function appendLog(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], sessionId: string, entry: string) {
    const [s] = await tx
        .select({ log: combatSessions.combat_log })
        .from(combatSessions)
        .where(eq(combatSessions.id, sessionId));
    const next = [...(s?.log ?? []), entry].slice(-MAX_LOG);
    await tx.update(combatSessions).set({ combat_log: next }).where(eq(combatSessions.id, sessionId));
}

// ---------------------------------------------------------------------------
// Setup / lifecycle
// ---------------------------------------------------------------------------

export async function createCombatSession(ctx: Ctx, input: { channelId: string; dmUserId: string }) {
    if (!input.channelId || !input.dmUserId) throw httpError(400, 'channelId and dmUserId are required');
    if (input.dmUserId !== ctx.discordId) throw httpError(403, 'A combat session must be created by its DM');

    const [existing] = await db
        .select({ id: combatSessions.id })
        .from(combatSessions)
        .where(
            and(
                eq(combatSessions.channel_id, input.channelId),
                inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED'])
            )
        )
        .limit(1);
    if (existing) throw httpError(409, 'An active combat session already exists in this channel');

    const [session] = await db
        .insert(combatSessions)
        .values({ channel_id: input.channelId, dm_user_id: input.dmUserId, state: 'SETUP' })
        .returning();
    return session;
}

export async function setMessageId(ctx: Ctx, sessionId: string, messageId: string) {
    const { session } = await loadSession(sessionId);
    assertDm(session, ctx);
    const [updated] = await db
        .update(combatSessions)
        .set({ message_id: messageId })
        .where(eq(combatSessions.id, sessionId))
        .returning();
    return updated;
}

export async function addCombatant(
    ctx: Ctx,
    input: {
        sessionId: string;
        type: 'PLAYER' | 'NPC';
        allegiance: 'PLAYER_SIDE' | 'HOSTILE';
        playerId?: number | null;
        mobDefinitionId?: number | null;
        discordUserId?: string | null;
        name: string;
        maxHp: number;
        currentHp: number;
        wounds?: number;
        woundThreshold?: number | null;
        initiativeBase?: number;
    }
) {
    const { session } = await loadSession(input.sessionId);
    assertDm(session, ctx);
    // createCombatant (db/operations) validates session + duplicate-discord-user.
    return createCombatantOp(input);
}

export async function removeCombatant(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session } = await loadSession(input.sessionId);
    assertDm(session, ctx);
    const [deleted] = await db
        .delete(combatants)
        .where(and(eq(combatants.id, input.combatantId), eq(combatants.session_id, input.sessionId)))
        .returning({ id: combatants.id });
    if (!deleted) throw httpError(404, 'Combatant not found');
    return { deleted: true };
}

/** Transition SETUP → RUNNING: roll initiative, sort, persist turn order + first active. */
export async function beginCombat(ctx: Ctx, sessionId: string) {
    const { session, combatants } = await loadSession(sessionId);
    assertDm(session, ctx);
    if (session.state !== 'SETUP') throw httpError(400, `Combat can only begin from SETUP (current: ${session.state})`);
    if (combatants.length < 2) throw httpError(400, 'Need at least two participants');

    const hasPlayers = combatants.some(c => c.allegiance === 'PLAYER_SIDE');
    const hasHostiles = combatants.some(c => c.allegiance === 'HOSTILE');
    if (!hasPlayers || !hasHostiles) throw httpError(400, 'Need participants from opposing sides');

    const rolled = combatants.map(c => ({
        id: c.id,
        initiativeRoll: rollDice(6) + (c.initiative_base ?? 0),
        initiativeBase: c.initiative_base ?? 0,
    }));
    rolled.sort((a, b) => b.initiativeRoll - a.initiativeRoll || b.initiativeBase - a.initiativeBase);

    const started = await startCombatOp({
        sessionId,
        turnOrder: rolled.map(r => r.id),
        combatantInitiatives: rolled.map(r => ({ combatantId: r.id, initiativeRoll: r.initiativeRoll })),
    });

    // startCombat doesn't set current_round; initialize it.
    if (!started.current_round || started.current_round < 1) {
        const [s] = await db
            .update(combatSessions)
            .set({ current_round: 1 })
            .where(eq(combatSessions.id, sessionId))
            .returning();
        return { ...started, current_round: s?.current_round ?? 1 };
    }
    return started;
}

export async function advanceTurn(
    ctx: Ctx,
    sessionId: string
): Promise<CombatState & { ended: boolean; reason?: string }> {
    let { session, combatants: combatantRows } = await loadSession(sessionId);
    assertDm(session, ctx);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');

    let turnOrder = session.turn_order ?? [];
    if (turnOrder.length === 0) throw httpError(400, 'No combatants in turn order');

    const outgoingId = turnOrder[session.current_turn_index ?? 0];
    const outgoing = combatantRows.find(combatant => combatant.id === outgoingId);
    if (outgoing) {
        await db.transaction(async tx => {
            const tick = await processTurnEnd(tx, outgoing);
            for (const entry of tick.logEntries) await appendLog(tx, sessionId, entry);
        });
        ({ session, combatants: combatantRows } = await loadSession(sessionId));
        turnOrder = session.turn_order ?? [];
    }

    const conscious = combatantRows.filter(c => c.current_hp > 0);
    const allegiances = new Set(conscious.map(c => c.allegiance));

    // Victory / draw: end the combat.
    if (conscious.length === 0) {
        await endCombatOp({ sessionId, reason: 'No survivors!' });
        return {
            session: (await loadSession(sessionId)).session,
            combatants: (await loadSession(sessionId)).combatants,
            ended: true,
            reason: 'No survivors!',
        };
    }
    if (allegiances.size === 1) {
        const winner = allegiances.has('PLAYER_SIDE') ? 'The players' : 'The hostile forces';
        await endCombatOp({ sessionId, reason: `${winner} are victorious!` });
        const fresh = await loadSession(sessionId);
        return { ...fresh, ended: true, reason: `${winner} are victorious!` };
    }

    // Find next conscious combatant.
    const n = turnOrder.length;
    let nextIndex = session.current_turn_index ?? 0;
    let found: CombatantRow | null = null;
    for (let i = 0; i < n; i++) {
        nextIndex = (nextIndex + 1) % n;
        const c = combatantRows.find(x => x.id === turnOrder[nextIndex]);
        if (c && c.current_hp > 0) {
            found = c;
            break;
        }
    }
    if (!found) {
        await endCombatOp({ sessionId, reason: 'No conscious combatant could take a turn' });
        const fresh = await loadSession(sessionId);
        return { ...fresh, ended: true, reason: 'No conscious combatant could take a turn' };
    }

    const previousIndex = session.current_turn_index ?? 0;
    const newRound = nextIndex <= previousIndex ? (session.current_round ?? 1) + 1 : (session.current_round ?? 1);

    await db.transaction(async tx => {
        if (newRound > (session.current_round ?? 1)) {
            await tx.update(combatants).set({ defense_count: 0 }).where(eq(combatants.session_id, sessionId));
            await tx.delete(combatantEffects).where(
                and(
                    inArray(
                        combatantEffects.combatant_id,
                        combatantRows.map(row => row.id)
                    ),
                    like(combatantEffects.effect_type, 'opportunity:%')
                )
            );
            await tx.delete(combatantEffects).where(
                and(
                    inArray(
                        combatantEffects.combatant_id,
                        combatantRows.map(row => row.id)
                    ),
                    inArray(combatantEffects.effect_type, ['miracle_at', 'miracle_pa'])
                )
            );
        }
        const startTick = await processTurnStart(tx, found!);
        await tx.update(combatants).set({ is_active_turn: false }).where(eq(combatants.session_id, sessionId));
        await tx.update(combatants).set({ is_active_turn: true }).where(eq(combatants.id, found!.id));
        await tx
            .update(combatSessions)
            .set({ current_turn_index: nextIndex, current_round: newRound })
            .where(eq(combatSessions.id, sessionId));
        for (const entry of startTick.logEntries) await appendLog(tx, sessionId, entry);
        await appendLog(tx, sessionId, `--- ${found!.name}'s Turn ---`);
    });

    return { ...(await loadSession(sessionId)), ended: false };
}

export async function endCombatSession(ctx: Ctx, input: { sessionId: string; reason?: string }) {
    const { session } = await loadSession(input.sessionId);
    assertDm(session, ctx);
    return endCombatOp({ sessionId: input.sessionId, reason: input.reason });
}

export async function parkCombat(ctx: Ctx, sessionId: string) {
    const { session } = await loadSession(sessionId);
    assertDm(session, ctx);
    if (session.state !== 'RUNNING') throw httpError(400, `Combat is not running (current: ${session.state})`);
    const [updated] = await db
        .update(combatSessions)
        .set({ state: 'PAUSED' })
        .where(eq(combatSessions.id, sessionId))
        .returning();
    return updated;
}

export async function resumeCombat(ctx: Ctx, sessionId: string) {
    const { session } = await loadSession(sessionId);
    assertDm(session, ctx);
    if (session.state !== 'PAUSED') throw httpError(400, `Combat is not paused (current: ${session.state})`);
    const [updated] = await db
        .update(combatSessions)
        .set({ state: 'RUNNING' })
        .where(eq(combatSessions.id, sessionId))
        .returning();
    return updated;
}

export async function cancelCombat(ctx: Ctx, sessionId: string) {
    const { session } = await loadSession(sessionId);
    assertDm(session, ctx);
    if (session.state !== 'SETUP') throw httpError(400, `Can only cancel a SETUP session (current: ${session.state})`);
    await db.delete(combatSessions).where(eq(combatSessions.id, sessionId));
    return { deleted: true };
}

function assertCombatantControl(ctx: Ctx, session: SessionRow, combatant: CombatantRow) {
    const isDm = session.dm_user_id === ctx.discordId;
    const ownsCombatant = combatant.discord_user_id === ctx.discordId;
    if ((combatant.type === 'PLAYER' && !ownsCombatant) || (combatant.type === 'NPC' && !isDm)) {
        throw httpError(403, 'Caller may not control this combatant');
    }
}

function assertActiveCombatant(session: SessionRow, combatant: CombatantRow) {
    const activeId = session.turn_order?.[session.current_turn_index ?? -1];
    if (combatant.id !== activeId) throw httpError(400, "It's not this combatant's turn");
}

async function assertCombatantCanAct(combatant: CombatantRow) {
    if (isIncapacitatedByWounds(combatant.wounds)) {
        throw httpError(400, `${combatant.name} is incapacitated by wounds`);
    }
    if ((await getCombatantModifiers(combatant)).modifiers.prohibitsActions) {
        throw httpError(400, `${combatant.name} is incapacitated or barred from acting`);
    }
}

/** Spend the active action on Verteidigungshaltung (+4 PA until the next turn). */
export async function takeFullDefense(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    if (combatant.type === 'PLAYER') {
        const [learned] = await db
            .select({ id: playerActionModifications.id })
            .from(playerActionModifications)
            .innerJoin(
                actionModifications,
                eq(playerActionModifications.action_modification_id, actionModifications.id)
            )
            .where(
                and(
                    eq(playerActionModifications.player_id, combatant.player_id!),
                    eq(actionModifications.name, 'Verteidigungshaltung')
                )
            )
            .limit(1);
        if (!learned) throw httpError(403, 'Combatant has not learned Verteidigungshaltung');
    }
    const [effect] = await db.transaction(async tx => {
        const inserted = await tx
            .insert(combatantEffects)
            .values({
                combatant_id: combatant.id,
                effect_type: 'full_defense',
                source: 'Verteidigungshaltung',
                pa_modifier: 4,
                prohibits_actions: true,
                duration_rounds: 1,
            })
            .onConflictDoUpdate({
                target: [combatantEffects.combatant_id, combatantEffects.effect_type],
                set: { pa_modifier: 4, prohibits_actions: true, duration_rounds: 1, updated_at: new Date() },
            })
            .returning();
        await appendLog(tx, input.sessionId, `${combatant.name} assumes Verteidigungshaltung (+4 PA).`);
        return inserted;
    });
    return effect;
}

/** Spend one action reducing the active ranged weapon's reload counter. */
export async function reloadAction(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    if (combatant.reload_remaining <= 0) throw httpError(400, 'No reload action is required');
    const remaining = combatant.reload_remaining - 1;
    const [updated] = await db.transaction(async tx => {
        const rows = await tx
            .update(combatants)
            .set({ reload_remaining: remaining })
            .where(eq(combatants.id, combatant.id))
            .returning();
        await appendLog(tx, input.sessionId, `${combatant.name} reloads (${remaining} action(s) remaining).`);
        return rows;
    });
    return updated;
}

/** Attempt to break a Haltegriff with a KK check; succeeds automatically for a natural 1. */
export async function escapeGrapple(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    const [fixed] = await db
        .select({ id: combatantStatuses.id })
        .from(combatantStatuses)
        .where(and(eq(combatantStatuses.combatant_id, combatant.id), eq(combatantStatuses.status_type, 'fixiert')))
        .limit(1);
    if (!fixed) throw httpError(400, 'Combatant is not grappled');
    let strength = 8;
    if (combatant.player_id) {
        const [row] = await db.select({ kk: stats.kk }).from(stats).where(eq(stats.player_id, combatant.player_id));
        strength = row?.kk || 8;
    }
    const roll = rollDice(20);
    const success = roll === 1 || (roll !== 20 && roll <= strength);
    await db.transaction(async tx => {
        if (success) {
            await tx
                .delete(combatantStatuses)
                .where(
                    and(
                        eq(combatantStatuses.combatant_id, combatant.id),
                        inArray(combatantStatuses.status_type, ['fixiert', 'eingeengt'])
                    )
                );
            const holds = await tx
                .select({ id: combatantEffects.id })
                .from(combatantEffects)
                .where(eq(combatantEffects.effect_type, `grappling:${combatant.id}`));
            if (holds.length > 0) {
                await tx.delete(combatantEffects).where(
                    inArray(
                        combatantEffects.id,
                        holds.map(row => row.id)
                    )
                );
            }
        }
        await appendLog(
            tx,
            input.sessionId,
            `${combatant.name} attempts to escape a grapple (${roll}/${strength}): ${success ? 'success' : 'failure'}.`
        );
    });
    return { roll, strength, success };
}

/** Spend the active action to remove the Liegend status. */
export async function standUp(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    const [status] = await db
        .select({ id: combatantStatuses.id })
        .from(combatantStatuses)
        .where(and(eq(combatantStatuses.combatant_id, combatant.id), eq(combatantStatuses.status_type, 'liegend')))
        .limit(1);
    if (!status) throw httpError(400, 'Combatant is not prone');
    await db.transaction(async tx => {
        await tx.delete(combatantStatuses).where(eq(combatantStatuses.id, status.id));
        await appendLog(tx, input.sessionId, `${combatant.name} stands up.`);
    });
    return { stoodUp: true };
}

// ---------------------------------------------------------------------------
// Attack resolution (the centerpiece)
// ---------------------------------------------------------------------------

async function getEffectiveCombatStats(combatant: CombatantRow, weaponId?: number | null) {
    if (combatant.type === 'PLAYER') {
        if (!combatant.player_id) throw httpError(400, 'Player combatant has no player_id');
        const [statRow] = await db.select().from(stats).where(eq(stats.player_id, combatant.player_id)).limit(1);
        if (!statRow) throw httpError(400, 'Player has no stats');
        const weaponRows = await db.select().from(weapons).where(eq(weapons.player_id, combatant.player_id));
        const offensive = weaponId
            ? weaponRows.find(w => w.id === weaponId && w.is_equipped === 'Y')
            : weaponRows.find(
                  w => w.is_equipped === 'Y' && (w.equipped_slot === 'OFFENSE' || w.equipped_slot === 'ADAPTIVE')
              );
        if (weaponId && !offensive) throw httpError(400, 'Selected attack weapon is not equipped by this combatant');
        const defensive = weaponRows.find(
            w => w.is_equipped === 'Y' && (w.equipped_slot === 'DEFENSE' || w.equipped_slot === 'ADAPTIVE')
        );
        const assignedRules = await db
            .select({ name: actionModifications.name, rules: actionModifications.rules })
            .from(playerActionModifications)
            .innerJoin(
                actionModifications,
                eq(playerActionModifications.action_modification_id, actionModifications.id)
            )
            .where(eq(playerActionModifications.player_id, combatant.player_id));
        const defensePenaltyStep = assignedRules.some(
            row =>
                row.rules &&
                typeof row.rules === 'object' &&
                (row.rules as { defense_penalty_step?: number }).defense_penalty_step === 2
        )
            ? 2
            : 3;
        return {
            at: offensive ? offensive.at : statRow.attacke_basis || 8,
            pa: defensive ? defensive.pa : statRow.parade_basis || 6,
            rs: statRow.ruestungsschutz || 0,
            tp: offensive ? (offensive.tp ?? '1w6') : '1w6',
            weaponType: offensive?.type ?? 'MELEE',
            combatTechnique: offensive
                ? (offensive.combat_technique ?? (offensive.type === 'RANGED' ? 'Bögen' : 'Schwerter'))
                : 'Raufen',
            weaponId: offensive?.id ?? null,
            isTwoHanded: offensive?.is_two_handed ?? false,
            secondWeapon: defensive && defensive.id !== offensive?.id && defensive.type === 'MELEE' ? defensive : null,
            rangeClose: offensive?.range_close ?? 10,
            rangeMedium: offensive?.range_medium ?? 50,
            rangeFar: offensive?.range_far ?? 100,
            reloadActions: offensive?.reload_actions ?? 0,
            defensePenaltyStep,
            attributes: {
                mu: statRow.mu,
                in: statRow.in,
                ge: statRow.ge,
                ff: statRow.ff,
                kk: statRow.kk,
            },
            learnedAbilityNames: assignedRules.map(row => row.name),
            handsFree: Math.max(
                0,
                2 -
                    weaponRows
                        .filter(weapon => weapon.is_equipped === 'Y')
                        .reduce((used, weapon) => used + (weapon.is_two_handed ? 2 : 1), 0)
            ),
            woundThreshold:
                combatant.wound_threshold ?? calculateWoundThreshold(statRow.ko, statRow.wound_threshold_modifier),
            movementSpeed: Math.max(0, combatant.movement_speed - statRow.belastung),
        };
    }
    // NPC
    if (!combatant.mob_definition_id) throw httpError(400, 'NPC combatant has no mob_definition_id');
    const [mob] = await db.select().from(mobs).where(eq(mobs.id, combatant.mob_definition_id)).limit(1);
    if (!mob) throw httpError(404, 'Mob definition not found');
    return {
        at: mob.base_attack_value,
        pa: mob.base_parry_value,
        rs: mob.base_armor_soak,
        tp: mob.base_damage_tp ?? '1w6',
        weaponType: 'MELEE' as const,
        combatTechnique: 'Raufen',
        weaponId: null,
        isTwoHanded: false,
        secondWeapon: null,
        rangeClose: 10,
        rangeMedium: 50,
        rangeFar: 100,
        reloadActions: 0,
        defensePenaltyStep: 3,
        attributes: { mu: 20, in: 20, ge: 20, ff: 20, kk: 20 },
        learnedAbilityNames: [],
        handsFree: 2,
        woundThreshold: combatant.wound_threshold ?? 0,
        movementSpeed: combatant.movement_speed,
    };
}

async function resolveWoundEffectResistance(
    combatant: CombatantRow,
    totalWounds: number,
    checkModifier: number
): Promise<AttackResultOut['woundEffectResistance']> {
    if (!combatant.player_id) {
        return { attempted: false, success: false, rolls: null, remainingFtw: null };
    }
    const [[statRow], [talentRow]] = await Promise.all([
        db.select({ mu: stats.mu, ko: stats.ko }).from(stats).where(eq(stats.player_id, combatant.player_id)).limit(1),
        db
            .select({ ftw: playerTalents.ftw })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(and(eq(playerTalents.player_id, combatant.player_id), eq(talents.name, 'Selbstbeherrschung')))
            .limit(1),
    ]);
    if (!statRow) return { attempted: false, success: false, rolls: null, remainingFtw: null };

    const penalty = calculateWoundPenalty(totalWounds);
    const attributes = [statRow.mu, statRow.mu, statRow.ko].map(value =>
        Math.max(0, (value || 8) - penalty + checkModifier)
    );
    const rolls: [number, number, number] = [rollDice(20), rollDice(20), rollDice(20)];
    const remainingFtw = rolls.reduce(
        (remaining, roll, index) => remaining - Math.max(0, roll - attributes[index]),
        talentRow?.ftw ?? 0
    );
    return { attempted: true, success: remainingFtw >= 0, rolls, remainingFtw };
}

export interface AttackResultOut {
    sessionId: string;
    attacker: { id: string; name: string };
    target: { id: string; name: string };
    maneuverName: string | null;
    atValue: number;
    paValue: number;
    defenseCountBefore: number;
    defenseCountAfter: number;
    defensePenalty: number;
    rangeBand: RangeBand | null;
    hitZone: HitZone | null;
    attack: { roll: number; confirmRoll: number | null; outcome: string };
    defense: { roll: number; success: boolean } | null;
    hitConnected: boolean;
    botchDamage: number;
    rolledDamage: number;
    damageBonus: number;
    totalDamage: number;
    finalDamage: number;
    zoneDamage: number;
    attackerHpBefore: number;
    attackerHpAfter: number;
    attackerWoundsBefore: number;
    attackerWoundsInflicted: number;
    attackerWoundsAfter: number;
    attackerReloadRemaining: number;
    targetHpBefore: number;
    targetHpAfter: number;
    targetWoundsBefore: number;
    targetWoundsInflicted: number;
    targetWoundsAfter: number;
    appliedEffects: string[];
    woundEffectResistance: {
        attempted: boolean;
        success: boolean;
        rolls: [number, number, number] | null;
        remainingFtw: number | null;
    } | null;
    opportunityGranted: boolean;
    logMessage: string;
}

export async function resolveAttackAction(
    ctx: Ctx,
    input: {
        sessionId: string;
        attackerId: string;
        targetId: string;
        maneuverId?: string | null;
        attackKind?: 'standard' | 'opportunity';
        hitZone?: HitZone | null;
        distance?: number | null;
        coverPenalty?: number;
        /** Internal override used by the paired-weapon action. */
        weaponId?: number | null;
        /** Internal AT modifier used by compound combat actions. */
        attackAtModifier?: number;
    }
): Promise<AttackResultOut> {
    const { session, combatants: combatantRows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');

    const attacker = combatantRows.find(c => c.id === input.attackerId);
    const target = combatantRows.find(c => c.id === input.targetId);
    if (!attacker) throw httpError(404, 'Attacker not found');
    if (!target) throw httpError(404, 'Target not found');
    if (target.current_hp <= 0) throw httpError(400, `${target.name} is already defeated`);
    if (isIncapacitatedByWounds(attacker.wounds)) {
        throw httpError(400, `${attacker.name} is incapacitated by wounds`);
    }

    assertCombatantControl(ctx, session, attacker);

    const attackKind = input.attackKind ?? 'standard';
    const turnOrder = session.turn_order ?? [];
    const activeId = turnOrder[session.current_turn_index ?? -1];
    if (attackKind === 'standard' && attacker.id !== activeId) {
        throw httpError(400, "It's not the attacker's turn");
    }

    let opportunityEffectId: string | null = null;
    if (attackKind === 'opportunity') {
        const [opportunity] = await db
            .select({ id: combatantEffects.id })
            .from(combatantEffects)
            .where(
                and(
                    eq(combatantEffects.combatant_id, attacker.id),
                    eq(combatantEffects.effect_type, `opportunity:${target.id}`)
                )
            )
            .limit(1);
        if (!opportunity) throw httpError(400, 'No opportunity attack is available against this target');
        opportunityEffectId = opportunity.id;
    }

    let maneuver: typeof actionModifications.$inferSelect | null = null;
    if (input.maneuverId && input.maneuverId !== 'null') {
        const [m] = await db
            .select()
            .from(actionModifications)
            .where(eq(actionModifications.id, input.maneuverId))
            .limit(1);
        if (!m) throw httpError(404, 'Combat maneuver not found');
        maneuver = m;
        if (attacker.type === 'PLAYER') {
            const [learned] = await db
                .select({ id: playerActionModifications.id })
                .from(playerActionModifications)
                .where(
                    and(
                        eq(playerActionModifications.player_id, attacker.player_id!),
                        eq(playerActionModifications.action_modification_id, m.id)
                    )
                )
                .limit(1);
            if (!learned) throw httpError(403, 'Attacker has not learned this maneuver');
        }
    }

    const [att, tar, attackerEffectState, targetEffectState] = await Promise.all([
        getEffectiveCombatStats(attacker, input.weaponId),
        getEffectiveCombatStats(target),
        getCombatantModifiers(attacker),
        getCombatantModifiers(target),
    ]);
    if (attackerEffectState.modifiers.prohibitsActions) {
        throw httpError(400, `${attacker.name} is incapacitated or barred from acting`);
    }
    const miracleAtEffect = attackerEffectState.state.effects.find(effect => effect.effect_type === 'miracle_at');
    const miraclePaEffect = targetEffectState.state.effects.find(effect => effect.effect_type === 'miracle_pa');
    if (maneuver?.action_type && maneuver.action_type !== att.weaponType) {
        throw httpError(400, `${maneuver.name} requires a ${maneuver.action_type.toLowerCase()} attack`);
    }
    if (maneuver?.prerequisites && typeof maneuver.prerequisites === 'object') {
        const prerequisites = maneuver.prerequisites as Record<string, unknown>;
        for (const attribute of ['mu', 'in', 'ge', 'ff', 'kk'] as const) {
            const required = prerequisites[attribute];
            if (Number.isInteger(required) && att.attributes[attribute] < (required as number)) {
                throw httpError(400, `${maneuver.name} requires ${attribute.toUpperCase()} ${required}`);
            }
        }
        if (
            Number.isInteger(prerequisites.ge_or_kk) &&
            Math.max(att.attributes.ge, att.attributes.kk) < (prerequisites.ge_or_kk as number)
        ) {
            throw httpError(400, `${maneuver.name} requires GE or KK ${prerequisites.ge_or_kk}`);
        }
        if (Number.isInteger(prerequisites.hands_free) && att.handsFree < (prerequisites.hands_free as number)) {
            throw httpError(400, `${maneuver.name} requires ${prerequisites.hands_free} free hands`);
        }
        if (Number.isInteger(prerequisites.value) && att.at < (prerequisites.value as number)) {
            throw httpError(400, `${maneuver.name} requires combat value ${prerequisites.value}`);
        }
        const requiredTechniques = [
            ...(typeof prerequisites.technique === 'string' ? [prerequisites.technique] : []),
            ...(Array.isArray(prerequisites.techniques)
                ? prerequisites.techniques.filter((value): value is string => typeof value === 'string')
                : []),
        ];
        if (requiredTechniques.length > 0 && !requiredTechniques.includes(att.combatTechnique)) {
            throw httpError(
                400,
                `${maneuver.name} requires one of these combat techniques: ${requiredTechniques.join(', ')}`
            );
        }
        const requiredAbilities = [
            ...(typeof prerequisites.requires === 'string' ? [prerequisites.requires] : []),
            ...(Array.isArray(prerequisites.requires)
                ? prerequisites.requires.filter((value): value is string => typeof value === 'string')
                : []),
        ];
        const missingAbility =
            attacker.type === 'PLAYER'
                ? requiredAbilities.find(name => !att.learnedAbilityNames.includes(name))
                : undefined;
        if (missingAbility) throw httpError(400, `${maneuver.name} requires ${missingAbility}`);
    }
    let atValue = att.at - calculateWoundPenalty(attacker.wounds) + attackerEffectState.modifiers.atModifier;
    const defensePenalty = getMultipleDefensePenalty(target.defense_count, tar.defensePenaltyStep);
    let paValue =
        tar.pa + calculateWoundPenalty(target.wounds) + targetEffectState.modifiers.paModifier - defensePenalty;
    let damageBonus = 0;
    let maneuverType: string | null = null;
    if (maneuver?.rules && typeof maneuver.rules === 'object') {
        const r = maneuver.rules as {
            type?: string;
            at_modifier?: number;
            opponent_pa_modifier?: number;
            damage_bonus?: number;
        };
        maneuverType = r.type ?? null;
        if (maneuverType && ['full_defense', 'masterful_parry', 'two_weapon_training'].includes(maneuverType)) {
            throw httpError(400, `${maneuver.name} is passive or uses its own combat action`);
        }
        if (r.at_modifier) atValue += r.at_modifier;
        if (r.opponent_pa_modifier) paValue += r.opponent_pa_modifier;
        if (r.damage_bonus) damageBonus += r.damage_bonus;
    }
    atValue += input.attackAtModifier ?? 0;
    damageBonus += attackerEffectState.modifiers.damageModifier;

    let rangeBand: RangeBand | null = null;
    if (att.weaponType === 'RANGED') {
        if (attacker.reload_remaining > 0) {
            throw httpError(400, `${attacker.name}'s weapon needs ${attacker.reload_remaining} reload action(s)`);
        }
        const distance = input.distance ?? 0;
        if (!Number.isFinite(distance) || distance < 0) throw httpError(400, 'distance must be a non-negative number');
        if (distance <= att.rangeClose) rangeBand = 'close';
        else if (distance <= att.rangeMedium) rangeBand = 'medium';
        else if (distance <= att.rangeFar) rangeBand = 'far';
        else throw httpError(400, 'Target is beyond the weapon range');
        const coverPenalty = input.coverPenalty ?? 0;
        if (!Number.isInteger(coverPenalty) || coverPenalty < 0 || coverPenalty > 4) {
            throw httpError(400, 'coverPenalty must be an integer from 0 to 4');
        }
        atValue += getRangePenalty(rangeBand) - coverPenalty;
    } else if (maneuverType === 'charge') {
        const runningDistance = input.distance;
        if (!Number.isInteger(runningDistance) || runningDistance! < 4) {
            throw httpError(400, 'Charge requires a running distance of at least 4 steps');
        }
        if (runningDistance! > att.movementSpeed) {
            throw httpError(400, 'Charge distance cannot exceed the attacker movement speed');
        }
    } else if (input.distance !== undefined && input.distance !== null) {
        throw httpError(400, 'distance is only valid for ranged attacks');
    }

    if (maneuverType === 'charge') {
        if (att.movementSpeed < 4) throw httpError(400, 'Charge requires movement speed 4 or higher');
        damageBonus += Math.min(10, 2 + Math.floor(att.movementSpeed / 2));
    }

    if (maneuverType === 'trip') {
        const sizeOrder = { small: 0, medium: 1, large: 2 } as const;
        const attackerSize = sizeOrder[attacker.creature_size as CreatureSize];
        const targetSize = sizeOrder[target.creature_size as CreatureSize];
        if (targetSize - attackerSize >= 2) throw httpError(400, 'Trip cannot target a creature two sizes larger');
        if (targetSize - attackerSize === 1) atValue -= 8;
    }

    if (input.hitZone) {
        if (!['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg'].includes(input.hitZone)) {
            throw httpError(400, 'Invalid hitZone');
        }
        let zonePenalty = getCalledShotPenalty(input.hitZone);
        if (maneuverType === 'called_shot') zonePenalty = Math.ceil(zonePenalty / 2);
        if (targetEffectState.state.statuses.some(status => status.status_type === 'ueberrascht')) {
            zonePenalty = Math.min(0, zonePenalty + 2);
        }
        atValue += zonePenalty;
    }

    if (attackKind === 'opportunity') atValue -= 4;
    atValue = Math.max(0, atValue);
    paValue = Math.max(0, paValue);

    const attack =
        attackKind === 'opportunity'
            ? (() => {
                  const roll = rollDice(20);
                  return { roll, confirmRoll: null, outcome: roll <= atValue ? 'NORMAL_HIT' : 'NORMAL_MISS' };
              })()
            : resolveAttack(atValue);
    let defense: { roll: number; success: boolean } | null = null;
    let hitConnected = false;
    let botchDamage = 0;

    if (attack.outcome === 'BOTCH') {
        botchDamage = Math.max(1, Math.floor(parseAndRollDamage(att.tp) / 2));
    } else if (attack.outcome === 'CRITICAL_SUCCESS') {
        hitConnected = true;
    } else if (
        attack.outcome === 'NORMAL_HIT' &&
        attackKind !== 'opportunity' &&
        !isIncapacitatedByWounds(target.wounds) &&
        !targetEffectState.modifiers.prohibitsDefense
    ) {
        defense = resolveDefense(paValue);
        hitConnected = !defense.success;
    } else if (attack.outcome === 'NORMAL_HIT') {
        hitConnected = true;
    }

    let rolledDamage = 0;
    let totalDamage = 0;
    let finalDamage = 0;
    if (hitConnected) {
        rolledDamage = parseAndRollDamage(att.tp);
        if (attack.outcome === 'CRITICAL_SUCCESS') rolledDamage *= 2;
        totalDamage = rolledDamage + damageBonus;
        finalDamage = applySoak(totalDamage, Math.max(0, tar.rs + targetEffectState.modifiers.armorModifier));
    }

    const hitZone = hitConnected
        ? (input.hitZone ?? resolveHumanoidHitZone(rollDice(20), target.creature_size as CreatureSize))
        : null;
    const attackerHpBefore = attacker.current_hp;
    const targetHpBefore = target.current_hp;
    const attackerHpAfter = botchDamage > 0 ? attacker.current_hp - botchDamage : attacker.current_hp;
    const attackerWoundResult = applyWoundDamage(attacker.wounds, botchDamage, att.woundThreshold);
    const targetWoundResult = applyWoundDamage(target.wounds, finalDamage, tar.woundThreshold);
    const zoneDamage = hitZone === 'torso' && targetWoundResult.woundsInflicted > 0 ? rollDice(3) + 1 : 0;
    const woundEffectResistance =
        hitZone && hitZone !== 'torso' && targetWoundResult.woundsInflicted > 0
            ? await resolveWoundEffectResistance(
                  target,
                  targetWoundResult.totalWounds,
                  targetEffectState.unencumberedCheckModifier
              )
            : null;
    const targetHpAfter =
        finalDamage + zoneDamage > 0 ? target.current_hp - finalDamage - zoneDamage : target.current_hp;
    const appliedEffects: string[] = [];
    let opportunityGranted = false;

    const logMessage = buildAttackLog({
        attackerName: attacker.name,
        targetName: target.name,
        maneuverName: maneuver?.name ?? null,
        atValue,
        attack,
        defense,
        hitConnected,
        botchDamage,
        rolledDamage,
        damageBonus,
        totalDamage,
        rs: tar.rs,
        finalDamage,
        attackerHpAfter,
        attackerMaxHp: attacker.max_hp,
        attackerWoundsInflicted: attackerWoundResult.woundsInflicted,
        attackerWoundsAfter: attackerWoundResult.totalWounds,
        attackerWoundThreshold: attackerWoundResult.woundThreshold,
        targetHpAfter,
        targetMaxHp: target.max_hp,
        targetWoundsInflicted: targetWoundResult.woundsInflicted,
        targetWoundsAfter: targetWoundResult.totalWounds,
        targetWoundThreshold: targetWoundResult.woundThreshold,
        hitZone,
        zoneDamage,
    });

    await db.transaction(async tx => {
        if (miracleAtEffect) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, miracleAtEffect.id));
        }
        if (miraclePaEffect && defense) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, miraclePaEffect.id));
        }
        if (opportunityEffectId) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, opportunityEffectId));
        }
        if (defense) {
            await tx
                .update(combatants)
                .set({ defense_count: target.defense_count + 1 })
                .where(eq(combatants.id, target.id));
        }
        if (att.weaponType === 'RANGED' && att.reloadActions > 0) {
            await tx
                .update(combatants)
                .set({ reload_remaining: att.reloadActions })
                .where(eq(combatants.id, attacker.id));
        }
        if (botchDamage > 0) {
            await tx
                .update(combatants)
                .set({ current_hp: attackerHpAfter, wounds: attackerWoundResult.totalWounds })
                .where(eq(combatants.id, attacker.id));
            if (attacker.player_id && attackerWoundResult.woundsInflicted > 0) {
                await tx
                    .update(stats)
                    .set({
                        le_current: attackerHpAfter,
                        wounds: sql`${stats.wounds} + ${attackerWoundResult.woundsInflicted}`,
                    })
                    .where(eq(stats.player_id, attacker.player_id));
            } else if (attacker.player_id) {
                await tx
                    .update(stats)
                    .set({ le_current: attackerHpAfter })
                    .where(eq(stats.player_id, attacker.player_id));
            }
        }
        if (finalDamage > 0) {
            await tx
                .update(combatants)
                .set({ current_hp: targetHpAfter, wounds: targetWoundResult.totalWounds, last_hit_zone: hitZone })
                .where(eq(combatants.id, target.id));
            if (target.player_id && targetWoundResult.woundsInflicted > 0) {
                await tx
                    .update(stats)
                    .set({
                        le_current: targetHpAfter,
                        wounds: sql`${stats.wounds} + ${targetWoundResult.woundsInflicted}`,
                    })
                    .where(eq(stats.player_id, target.player_id));
            } else if (target.player_id) {
                await tx.update(stats).set({ le_current: targetHpAfter }).where(eq(stats.player_id, target.player_id));
            }
        }
        if (hitConnected && finalDamage === 0 && hitZone) {
            await tx.update(combatants).set({ last_hit_zone: hitZone }).where(eq(combatants.id, target.id));
        }

        const applyBinaryStatus = async (statusType: string, source: string) => {
            await tx
                .insert(combatantStatuses)
                .values({ combatant_id: target.id, status_type: statusType, source, duration_rounds: null })
                .onConflictDoUpdate({
                    target: [combatantStatuses.combatant_id, combatantStatuses.status_type],
                    set: { source, duration_rounds: null, updated_at: new Date() },
                });
            appliedEffects.push(statusType);
        };

        const disarmTarget = async () => {
            if (!target.player_id) return;
            const dropped = await tx
                .update(weapons)
                .set({ is_equipped: 'N', equipped_slot: null })
                .where(
                    and(
                        eq(weapons.player_id, target.player_id),
                        eq(weapons.is_equipped, 'Y'),
                        inArray(weapons.equipped_slot, ['OFFENSE', 'ADAPTIVE'])
                    )
                )
                .returning({ id: weapons.id });
            if (dropped.length > 0) appliedEffects.push('disarmed');
        };

        if (hitConnected && maneuverType === 'disarm') await disarmTarget();
        if (hitConnected && maneuverType === 'trip') await applyBinaryStatus('liegend', maneuver?.name ?? 'Trip');
        if (hitConnected && maneuverType === 'grapple') {
            await applyBinaryStatus('fixiert', maneuver?.name ?? 'Grapple');
            await applyBinaryStatus('eingeengt', maneuver?.name ?? 'Grapple');
            await tx
                .insert(combatantEffects)
                .values({
                    combatant_id: attacker.id,
                    effect_type: `grappling:${target.id}`,
                    source: maneuver?.name ?? 'Grapple',
                    prohibits_defense: true,
                })
                .onConflictDoUpdate({
                    target: [combatantEffects.combatant_id, combatantEffects.effect_type],
                    set: { prohibits_defense: true, updated_at: new Date() },
                });
            appliedEffects.push('grappling');
        }

        if (hitConnected && targetWoundResult.woundsInflicted > 0 && hitZone && !woundEffectResistance?.success) {
            if (hitZone === 'head') {
                await tx
                    .insert(combatantConditions)
                    .values({
                        combatant_id: target.id,
                        condition_type: 'betaeubung',
                        level: 1,
                        source: 'Wound: head',
                    })
                    .onConflictDoUpdate({
                        target: [combatantConditions.combatant_id, combatantConditions.condition_type],
                        set: {
                            level: sql`least(4, ${combatantConditions.level} + 1)`,
                            source: 'Wound: head',
                            updated_at: new Date(),
                        },
                    });
                appliedEffects.push('betaeubung');
            } else if (hitZone.endsWith('_arm')) {
                await disarmTarget();
            } else if (hitZone.endsWith('_leg')) {
                await applyBinaryStatus('liegend', 'Wound: leg');
            }
            if (zoneDamage > 0) appliedEffects.push(`torso_damage:${zoneDamage}`);
        }

        if (woundEffectResistance?.attempted) {
            await appendLog(
                tx,
                input.sessionId,
                `${target.name} ${woundEffectResistance.success ? 'resists' : 'fails to resist'} the wound effect ` +
                    `(${woundEffectResistance.rolls!.join('/')}; remaining FtW ${woundEffectResistance.remainingFtw}).`
            );
        }

        if (maneuverType === 'charge' && attack.outcome === 'NORMAL_MISS') {
            await tx
                .insert(combatantEffects)
                .values({
                    combatant_id: target.id,
                    effect_type: `opportunity:${attacker.id}`,
                    source: `Failed charge by ${attacker.name}`,
                    duration_rounds: null,
                })
                .onConflictDoUpdate({
                    target: [combatantEffects.combatant_id, combatantEffects.effect_type],
                    set: { source: `Failed charge by ${attacker.name}`, duration_rounds: null, updated_at: new Date() },
                });
            opportunityGranted = true;
        }
        await appendLog(tx, input.sessionId, logMessage);
        if (appliedEffects.length > 0) {
            await appendLog(tx, input.sessionId, `${target.name}: ${appliedEffects.join(', ')} applied.`);
        }
        if (opportunityGranted) {
            await appendLog(
                tx,
                input.sessionId,
                `${target.name} gains an opportunity attack against ${attacker.name}.`
            );
        }
    });

    return {
        sessionId: input.sessionId,
        attacker: { id: attacker.id, name: attacker.name },
        target: { id: target.id, name: target.name },
        maneuverName: maneuver?.name ?? null,
        atValue,
        paValue,
        defenseCountBefore: target.defense_count,
        defenseCountAfter: target.defense_count + (defense ? 1 : 0),
        defensePenalty,
        rangeBand,
        hitZone,
        attack: { roll: attack.roll, confirmRoll: attack.confirmRoll, outcome: attack.outcome },
        defense,
        hitConnected,
        botchDamage,
        rolledDamage,
        damageBonus,
        totalDamage,
        finalDamage,
        zoneDamage,
        attackerHpBefore,
        attackerHpAfter,
        attackerWoundsBefore: attackerWoundResult.previousWounds,
        attackerWoundsInflicted: attackerWoundResult.woundsInflicted,
        attackerWoundsAfter: attackerWoundResult.totalWounds,
        attackerReloadRemaining: att.weaponType === 'RANGED' ? att.reloadActions : attacker.reload_remaining,
        targetHpBefore,
        targetHpAfter,
        targetWoundsBefore: targetWoundResult.previousWounds,
        targetWoundsInflicted: targetWoundResult.woundsInflicted,
        targetWoundsAfter: targetWoundResult.totalWounds,
        appliedEffects,
        woundEffectResistance,
        opportunityGranted,
        logMessage,
    };
}

export interface TwoWeaponAttackResult {
    penalty: number;
    offHandPenalty: number;
    attacks: AttackResultOut[];
    secondAttackSkipped: boolean;
    skipReason: string | null;
}

/** Resolve the paired attacks of Beidhändiger Kampf as one action. */
export async function resolveTwoWeaponAttackAction(
    ctx: Ctx,
    input: { sessionId: string; attackerId: string; targetIds: [string, string?] }
): Promise<TwoWeaponAttackResult> {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const attacker = rows.find(row => row.id === input.attackerId);
    if (!attacker) throw httpError(404, 'Attacker not found');
    assertCombatantControl(ctx, session, attacker);
    assertActiveCombatant(session, attacker);
    if (attacker.type !== 'PLAYER' || !attacker.player_id) {
        throw httpError(400, 'Two-weapon fighting currently requires a player weapon inventory');
    }
    if (!Array.isArray(input.targetIds) || input.targetIds.length < 1 || input.targetIds.length > 2) {
        throw httpError(400, 'targetIds must contain one or two combatants');
    }

    const equipment = await getEffectiveCombatStats(attacker);
    const secondWeapon = equipment.secondWeapon;
    if (!equipment.weaponId || !secondWeapon) {
        throw httpError(400, 'Two distinct equipped melee weapons are required');
    }
    if (equipment.weaponType !== 'MELEE' || secondWeapon.type !== 'MELEE') {
        throw httpError(400, 'Two-weapon fighting only supports melee weapons');
    }
    if (equipment.isTwoHanded || secondWeapon.is_two_handed) {
        throw httpError(400, 'Two-handed weapons cannot be used for two-weapon fighting');
    }

    const learned = await db
        .select({ rules: actionModifications.rules })
        .from(playerActionModifications)
        .innerJoin(actionModifications, eq(playerActionModifications.action_modification_id, actionModifications.id))
        .where(eq(playerActionModifications.player_id, attacker.player_id));
    const trainingPenalties = learned
        .map(row => row.rules as { type?: string; two_weapon_penalty?: number } | null)
        .filter(rule => rule?.type === 'two_weapon_training' && Number.isInteger(rule.two_weapon_penalty))
        .map(rule => rule!.two_weapon_penalty!);
    const { mainHand: penalty, offHand: offHandPenalty } = getTwoWeaponPenalties(trainingPenalties);
    const secondTargetId = input.targetIds[1] ?? input.targetIds[0];

    const first = await resolveAttackAction(ctx, {
        sessionId: input.sessionId,
        attackerId: attacker.id,
        targetId: input.targetIds[0],
        weaponId: equipment.weaponId,
        attackAtModifier: penalty,
    });
    if (first.attack.outcome === 'BOTCH') {
        return {
            penalty,
            offHandPenalty,
            attacks: [first],
            secondAttackSkipped: true,
            skipReason: 'The first attack botched',
        };
    }
    if (first.target.id === secondTargetId && first.targetHpAfter <= 0) {
        return {
            penalty,
            offHandPenalty,
            attacks: [first],
            secondAttackSkipped: true,
            skipReason: 'The shared target was defeated by the first attack',
        };
    }

    const second = await resolveAttackAction(ctx, {
        sessionId: input.sessionId,
        attackerId: attacker.id,
        targetId: secondTargetId,
        weaponId: secondWeapon.id,
        attackAtModifier: offHandPenalty,
    });
    return { penalty, offHandPenalty, attacks: [first, second], secondAttackSkipped: false, skipReason: null };
}

interface LogInput {
    attackerName: string;
    targetName: string;
    maneuverName: string | null;
    atValue: number;
    attack: { roll: number; confirmRoll: number | null; outcome: string };
    defense: { roll: number; success: boolean } | null;
    hitConnected: boolean;
    botchDamage: number;
    rolledDamage: number;
    damageBonus: number;
    totalDamage: number;
    rs: number;
    finalDamage: number;
    attackerHpAfter: number;
    attackerMaxHp: number;
    attackerWoundsInflicted: number;
    attackerWoundsAfter: number;
    attackerWoundThreshold: number;
    targetHpAfter: number;
    targetMaxHp: number;
    targetWoundsInflicted: number;
    targetWoundsAfter: number;
    targetWoundThreshold: number;
    hitZone: HitZone | null;
    zoneDamage: number;
}

function buildAttackLog(i: LogInput): string {
    let m = i.attackerName + (i.maneuverName ? ` uses **${i.maneuverName}**` : '') + ` attacks ${i.targetName}.`;
    m += ` (Roll: ${i.attack.roll}/${i.atValue})`;
    if (i.attack.confirmRoll !== null) m += ` (Confirm: ${i.attack.confirmRoll})`;

    if (i.attack.outcome === 'BOTCH') {
        m += ` -> **BOTCH!** ${i.attackerName} injures themselves for ${i.botchDamage} damage! | ${i.attackerName} HP: ${i.attackerHpAfter}/${i.attackerMaxHp}.`;
        if (i.attackerWoundsInflicted > 0) {
            m += ` **Wounds +${i.attackerWoundsInflicted}** (${i.attackerWoundsAfter} total; threshold ${i.attackerWoundThreshold}).`;
            if (isIncapacitatedByWounds(i.attackerWoundsAfter)) m += ` **Incapacitated by wounds!**`;
        }
        if (i.attackerHpAfter <= 0) m += ` **Self-defeated!**`;
        return m;
    }
    if (i.attack.outcome === 'CRITICAL_SUCCESS') {
        m += ` -> **CRITICAL!** Cannot be parried!`;
    } else if (i.attack.outcome === 'NORMAL_HIT') {
        if (i.defense) {
            m += ` | ${i.targetName} Parry: ${i.defense.roll}.`;
            m += i.defense.success ? ` **Parried!**` : ` Parry Failed.`;
        }
    } else {
        m += ` -> **Miss!**`;
    }

    if (i.hitConnected) {
        const dmgLog =
            i.damageBonus > 0
                ? ` | ${i.rolledDamage} + ${i.damageBonus} (Skill) = ${i.totalDamage} TP`
                : ` | ${i.totalDamage} TP`;
        m += `${dmgLog} - ${i.rs} RS = **${i.finalDamage} DMG!** | ${i.targetName} HP: ${i.targetHpAfter}/${i.targetMaxHp}.`;
        if (i.hitZone) m += ` Hit zone: **${i.hitZone}**.`;
        if (i.zoneDamage > 0) m += ` Torso wound: **+${i.zoneDamage} SP**.`;
        if (i.targetWoundsInflicted > 0) {
            m += ` **Wounds +${i.targetWoundsInflicted}** (${i.targetWoundsAfter} total; threshold ${i.targetWoundThreshold}).`;
            if (isIncapacitatedByWounds(i.targetWoundsAfter)) m += ` **Incapacitated by wounds!**`;
        }
        if (i.targetHpAfter <= 0) m += ` **Defeated!**`;
    }
    return m;
}

export { loadSession };
export {
    applyCondition,
    applyEffect,
    applyStatus,
    listConditions,
    listEffects,
    listStatuses,
    removeCondition,
    removeEffect,
    removeStatus,
    resistCondition,
} from './combatEffects';
