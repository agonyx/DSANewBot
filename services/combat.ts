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
import { eq, and, desc, inArray, like, sql, or, lt } from 'drizzle-orm';
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
    playerSpells,
    playerLiturgies,
    talents,
    combatantEffects,
    combatantStatuses,
    combatActions,
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
    getTwoWeaponPenalties,
    resolveHumanoidHitZone,
    type CreatureSize,
    type HitZone,
    type RangeBand,
} from '../utils/combatEffectUtils';
import type { Ctx } from './_ctx';
import { getCombatantModifiers, loadEffectsForCombatants, processTurnEnd, processTurnStart } from './combatEffects';
import {
    evaluateActionAvailability,
    evaluateDefenseOptions,
    evaluateManeuverEligibility,
    getRangedBandModifiers,
    type DefenseChoice,
    type DefenseOption,
} from '../utils/combatRules';
import { spendPlayerResourceInTransaction, type ResourceKey } from './resources';

const MAX_LOG = 20;

type SessionRow = typeof combatSessions.$inferSelect;
type CombatantRow = typeof combatants.$inferSelect;
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
        creatureSize?: CreatureSize;
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

    const [unresolvedAction] = await db
        .select({ id: combatActions.id })
        .from(combatActions)
        .where(
            and(
                eq(combatActions.session_id, sessionId),
                eq(combatActions.action_type, 'ATTACK'),
                inArray(combatActions.status, ['PENDING', 'RESOLVING'])
            )
        )
        .limit(1);
    if (unresolvedAction) throw httpError(409, 'Resolve the pending defense before advancing the turn');

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
        await tx
            .update(combatants)
            .set({
                is_active_turn: true,
                action_spent: false,
                free_action_spent: false,
            })
            .where(eq(combatants.id, found!.id));
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

function assertActionAvailable(combatant: CombatantRow) {
    if (combatant.action_spent) throw httpError(409, `${combatant.name} has already spent this turn's action`);
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
    assertActionAvailable(combatant);
    if (combatant.free_action_spent) {
        throw httpError(409, 'Verteidigungshaltung must be declared before any action or free action this turn');
    }
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
        await tx.update(combatants).set({ action_spent: true }).where(eq(combatants.id, combatant.id));
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
    assertActionAvailable(combatant);
    if (combatant.reload_remaining <= 0) throw httpError(400, 'No reload action is required');
    const remaining = combatant.reload_remaining - 1;
    const [updated] = await db.transaction(async tx => {
        const rows = await tx
            .update(combatants)
            .set({ reload_remaining: remaining, action_spent: true })
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
    assertActionAvailable(combatant);
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
        await tx.update(combatants).set({ action_spent: true }).where(eq(combatants.id, combatant.id));
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
    assertActionAvailable(combatant);
    const [status] = await db
        .select({ id: combatantStatuses.id })
        .from(combatantStatuses)
        .where(and(eq(combatantStatuses.combatant_id, combatant.id), eq(combatantStatuses.status_type, 'liegend')))
        .limit(1);
    if (!status) throw httpError(400, 'Combatant is not prone');
    await db.transaction(async tx => {
        await tx.delete(combatantStatuses).where(eq(combatantStatuses.id, status.id));
        await tx.update(combatants).set({ action_spent: true }).where(eq(combatants.id, combatant.id));
        await appendLog(tx, input.sessionId, `${combatant.name} stands up.`);
    });
    return { stoodUp: true };
}

function boundedActionText(value: string, label: string): string {
    const normalized = String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/@/g, '@\u200b')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized || normalized.length > 240) throw httpError(400, `${label} must contain 1 to 240 characters`);
    return normalized;
}

export async function getCombatActionMenu(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    if (session.dm_user_id !== ctx.discordId) assertCombatantControl(ctx, session, combatant);
    const activeTurn = session.turn_order?.[session.current_turn_index ?? -1] === combatant.id;
    const state = await getCombatantModifiers(combatant);
    const statuses = new Set(state.state.statuses.map(status => status.status_type));
    const hasDroppedItem = combatant.player_id
        ? Boolean(
              (
                  await db
                      .select({ id: weapons.id })
                      .from(weapons)
                      .where(
                          and(
                              eq(weapons.player_id, combatant.player_id),
                              eq(weapons.is_dropped, true),
                              eq(weapons.dropped_session_id, input.sessionId)
                          )
                      )
                      .limit(1)
              )[0]
          )
        : false;
    let hasResourcePool = false;
    let hasCompatibleManeuver = false;
    let canUseTwoWeapons = false;
    let canUseFullDefense = combatant.type === 'NPC';
    let hasLearnedSupernatural = false;
    const [opportunity] = await db
        .select({ id: combatantEffects.id })
        .from(combatantEffects)
        .where(
            and(eq(combatantEffects.combatant_id, combatant.id), like(combatantEffects.effect_type, 'opportunity:%'))
        )
        .limit(1);
    if (combatant.player_id) {
        const [[row], effective, [fullDefense], [learnedSpell], [learnedLiturgy]] = await Promise.all([
            db
                .select({ asp: stats.asp_max, kap: stats.kap_max, schp: stats.schicksalspunkte_max })
                .from(stats)
                .where(eq(stats.player_id, combatant.player_id)),
            getEffectiveCombatStats(combatant),
            db
                .select({ id: playerActionModifications.id })
                .from(playerActionModifications)
                .innerJoin(
                    actionModifications,
                    eq(playerActionModifications.action_modification_id, actionModifications.id)
                )
                .where(
                    and(
                        eq(playerActionModifications.player_id, combatant.player_id),
                        eq(actionModifications.name, 'Verteidigungshaltung')
                    )
                )
                .limit(1),
            db
                .select({ id: playerSpells.id })
                .from(playerSpells)
                .where(eq(playerSpells.player_id, combatant.player_id))
                .limit(1),
            db
                .select({ id: playerLiturgies.id })
                .from(playerLiturgies)
                .where(eq(playerLiturgies.player_id, combatant.player_id))
                .limit(1),
        ]);
        hasResourcePool = Boolean(row && (row.asp > 0 || row.kap > 0 || row.schp > 0));
        canUseTwoWeapons = Boolean(
            effective.weaponId &&
            effective.secondWeapon &&
            effective.weaponType === 'MELEE' &&
            effective.secondWeapon.type === 'MELEE' &&
            !effective.isTwoHanded &&
            !effective.secondWeapon.is_two_handed
        );
        canUseFullDefense = Boolean(fullDefense);
        hasLearnedSupernatural = Boolean(learnedSpell || learnedLiturgy);
        if (activeTurn) {
            const evaluated = await getAvailableCombatManeuvers(ctx, {
                sessionId: input.sessionId,
                combatantId: combatant.id,
            });
            hasCompatibleManeuver = evaluated.some(entry => entry.eligibility.available);
        }
    }
    const options = evaluateActionAvailability({
        activeTurn,
        incapacitated: isIncapacitatedByWounds(combatant.wounds) || state.modifiers.prohibitsActions,
        actionSpent: combatant.action_spent,
        freeActionSpent: combatant.free_action_spent,
        reloading: combatant.reload_remaining > 0,
        prone: statuses.has('liegend'),
        grappled: statuses.has('fixiert') || statuses.has('eingeengt'),
        hasDroppedItem,
        hasResourcePool,
        turnOpening: !combatant.action_spent && !combatant.free_action_spent,
        hasCompatibleManeuver,
        canUseTwoWeapons,
        hasOpportunity: Boolean(opportunity),
        canUseFullDefense,
        hasLearnedSupernatural,
    });
    return {
        sessionId: input.sessionId,
        combatantId: combatant.id,
        options,
    };
}

export async function getAvailableCombatManeuvers(ctx: Ctx, input: { sessionId: string; combatantId: string }) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    if (session.dm_user_id !== ctx.discordId) assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    if (!combatant.player_id) return [];
    const effective = await getEffectiveCombatStats(combatant);
    const learned = await db
        .select({ maneuver: actionModifications })
        .from(playerActionModifications)
        .innerJoin(actionModifications, eq(playerActionModifications.action_modification_id, actionModifications.id))
        .where(eq(playerActionModifications.player_id, combatant.player_id));
    return learned.map(({ maneuver }) => {
        const rules =
            maneuver.rules && typeof maneuver.rules === 'object' ? (maneuver.rules as { type?: string }) : null;
        const eligibility = evaluateManeuverEligibility({
            learned: true,
            weaponType: effective.weaponType,
            maneuverActionType: maneuver.action_type,
            maneuverType: rules?.type,
            prerequisites:
                maneuver.prerequisites && typeof maneuver.prerequisites === 'object'
                    ? (maneuver.prerequisites as Record<string, unknown>)
                    : null,
            attributes: effective.attributes,
            combatValue: effective.at,
            handsFree: effective.handsFree,
            combatTechnique: effective.combatTechnique,
            learnedAbilityNames: effective.learnedAbilityNames,
        });
        return { maneuver, eligibility };
    });
}

export async function recordGenericCombatAction(
    ctx: Ctx,
    input: { sessionId: string; combatantId: string; description: string; freeAction?: boolean }
) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    const description = boundedActionText(input.description, input.freeAction ? 'Free action' : 'Action');
    const spentColumn = input.freeAction ? combatants.free_action_spent : combatants.action_spent;
    const actionKind = input.freeAction ? 'FREE_ACTION' : 'ACTION';
    return db.transaction(async tx => {
        const [spent] = await tx
            .update(combatants)
            .set(input.freeAction ? { free_action_spent: true } : { action_spent: true })
            .where(and(eq(combatants.id, combatant.id), eq(spentColumn, false)))
            .returning({ id: combatants.id });
        if (!spent) throw httpError(409, `${actionKind.replace('_', ' ').toLowerCase()} already spent this turn`);
        const [action] = await tx
            .insert(combatActions)
            .values({
                session_id: input.sessionId,
                actor_id: combatant.id,
                action_kind: actionKind,
                action_type: input.freeAction ? 'FREE_ACTION' : 'GENERIC',
                status: 'RESOLVED',
                payload: { description },
                result: { recorded: true },
                decision_by_discord_id: ctx.discordId,
                resolved_at: new Date(),
            })
            .returning();
        await appendLog(
            tx,
            input.sessionId,
            `${combatant.name} uses ${input.freeAction ? 'a free action' : 'their action'}: ${description}`
        );
        return action;
    });
}

export async function spendCombatResource(
    ctx: Ctx,
    input: { sessionId: string; combatantId: string; type: ResourceKey; amount: number; reason: string }
) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant) throw httpError(404, 'Combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    if (!combatant.discord_user_id || !combatant.player_id) {
        throw httpError(400, 'This combatant has no character resource pool');
    }
    const reason = boundedActionText(input.reason, 'Resource reason');
    return db.transaction(async tx => {
        const mutation = await spendPlayerResourceInTransaction(tx, {
            playerId: combatant.player_id!,
            type: input.type,
            amount: input.amount,
        });
        await tx.insert(combatActions).values({
            session_id: input.sessionId,
            actor_id: combatant.id,
            action_kind: 'SYSTEM_REACTION',
            action_type: 'RESOURCE',
            status: 'RESOLVED',
            payload: { type: input.type, amount: input.amount, reason, consumesAction: false },
            result: { oldValue: mutation.oldValue, newValue: mutation.newValue },
            decision_by_discord_id: ctx.discordId,
            resolved_at: new Date(),
        });
        await appendLog(
            tx,
            input.sessionId,
            `${combatant.name} spends ${input.amount} ${input.type.toUpperCase()} (${reason}); this does not consume an action.`
        );
        return mutation;
    });
}

/** Retrieve one persisted dropped weapon with a Körperbeherrschung (GE/GE/KO) check. */
export async function retrieveDroppedWeapon(
    ctx: Ctx,
    input: { sessionId: string; combatantId: string; weaponId: number; opponentId?: string | null }
) {
    const { session, combatants: rows } = await loadSession(input.sessionId);
    if (session.state !== 'RUNNING') throw httpError(400, 'Combat is not running');
    const combatant = rows.find(row => row.id === input.combatantId);
    if (!combatant?.player_id) throw httpError(404, 'Player combatant not found');
    assertCombatantControl(ctx, session, combatant);
    assertActiveCombatant(session, combatant);
    await assertCombatantCanAct(combatant);
    assertActionAvailable(combatant);
    const [weapon] = await db
        .select()
        .from(weapons)
        .where(
            and(
                eq(weapons.id, input.weaponId),
                eq(weapons.player_id, combatant.player_id),
                eq(weapons.is_dropped, true),
                eq(weapons.dropped_session_id, input.sessionId)
            )
        );
    if (!weapon) throw httpError(404, 'Dropped weapon not found');
    const [[attributes], [bodyControl]] = await Promise.all([
        db.select({ ge: stats.ge, ko: stats.ko }).from(stats).where(eq(stats.player_id, combatant.player_id)),
        db
            .select({ ftw: playerTalents.ftw })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(and(eq(playerTalents.player_id, combatant.player_id), eq(talents.name, 'Körperbeherrschung'))),
    ]);
    const rolls: [number, number, number] = [rollDice(20), rollDice(20), rollDice(20)];
    const values = [attributes?.ge || 8, attributes?.ge || 8, attributes?.ko || 8];
    const remainingFtw = rolls.reduce(
        (remaining, roll, index) => remaining - Math.max(0, roll - values[index]),
        bodyControl?.ftw ?? 0
    );
    const success = remainingFtw >= 0;
    const opponent = input.opponentId ? rows.find(row => row.id === input.opponentId) : null;
    if (opponent && opponent.allegiance === combatant.allegiance)
        throw httpError(400, 'Opponent must be on the other side');
    await db.transaction(async tx => {
        await tx.update(combatants).set({ action_spent: true }).where(eq(combatants.id, combatant.id));
        if (success) {
            await tx
                .update(weapons)
                .set({ is_dropped: false, dropped_session_id: null, dropped_at: null })
                .where(eq(weapons.id, weapon.id));
        } else if (opponent) {
            await tx
                .insert(combatantEffects)
                .values({
                    combatant_id: opponent.id,
                    effect_type: `opportunity:${combatant.id}`,
                    source: `Failed retrieval by ${combatant.name}`,
                    duration_rounds: null,
                })
                .onConflictDoUpdate({
                    target: [combatantEffects.combatant_id, combatantEffects.effect_type],
                    set: { source: `Failed retrieval by ${combatant.name}`, updated_at: new Date() },
                });
        }
        await appendLog(
            tx,
            input.sessionId,
            `${combatant.name} tries to retrieve ${weapon.name} (${rolls.join('/')}; FtW ${remainingFtw}): ${
                success ? 'success' : 'failure'
            }${!success && opponent ? `; ${opponent.name} gains an opportunity attack` : ''}.`
        );
    });
    return {
        success,
        rolls,
        remainingFtw,
        weaponId: weapon.id,
        opportunityGrantedTo: !success ? (opponent?.id ?? null) : null,
    };
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
            dodge: statRow.ausweichen || 0,
            rs: statRow.ruestungsschutz || 0,
            tp: offensive ? (offensive.tp ?? '1w6') : '1w6',
            weaponType: offensive?.type ?? 'MELEE',
            combatTechnique: offensive
                ? (offensive.combat_technique ?? (offensive.type === 'RANGED' ? 'Bögen' : 'Schwerter'))
                : 'Raufen',
            weaponId: offensive?.id ?? null,
            isTwoHanded: offensive?.is_two_handed ?? false,
            isShield: (offensive?.shield_pa_bonus ?? 0) > 0,
            hasParryWeapon: Boolean(defensive) || (statRow.parade_basis || 0) > 0,
            hasShield: (defensive?.shield_pa_bonus ?? 0) > 0,
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
        dodge: Math.max(0, mob.base_parry_value - 2),
        rs: mob.base_armor_soak,
        tp: mob.base_damage_tp ?? '1w6',
        weaponType: 'MELEE' as const,
        combatTechnique: 'Raufen',
        weaponId: null,
        isTwoHanded: false,
        isShield: false,
        hasParryWeapon: mob.base_parry_value > 0,
        hasShield: false,
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
    defense: {
        choice: Exclude<DefenseChoice, 'DECLINE'>;
        value: number;
        roll: number;
        success: boolean;
        interruptedLongAction: boolean;
    } | null;
    defenseChoice: DefenseChoice | null;
    defenseOptions: DefenseOption[];
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

export interface AttackActionInput {
    sessionId: string;
    attackerId: string;
    targetId: string;
    maneuverId?: string | null;
    attackKind?: 'standard' | 'opportunity';
    rangedAttackType?: 'shooting' | 'thrown';
    hitZone?: HitZone | null;
    distance?: number | null;
    coverPenalty?: number;
    weaponId?: number | null;
    attackAtModifier?: number;
    defenseChoice?: DefenseChoice;
}

interface PreparedAttack {
    input: AttackActionInput;
    attacker: { id: string; name: string };
    target: { id: string; name: string };
    maneuverName: string | null;
    attack: { roll: number; confirmRoll: number | null; outcome: string };
    atValue: number;
    defenseOptions: DefenseOption[];
    requiresDecision: boolean;
}

interface InternalAttackInput extends AttackActionInput {
    preparationOnly?: boolean;
    preparedAttack?: PreparedAttack['attack'];
    transaction?: DbTx;
    ignoreActionSpent?: boolean;
}

async function executeAttackAction(ctx: Ctx, input: InternalAttackInput): Promise<AttackResultOut | PreparedAttack> {
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
    if (attackKind === 'standard' && input.preparationOnly && !input.ignoreActionSpent) assertActionAvailable(attacker);

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
    let maneuverLearned = true;
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
            maneuverLearned = Boolean(learned);
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
    const maneuverRules =
        maneuver?.rules && typeof maneuver.rules === 'object'
            ? (maneuver.rules as {
                  type?: string;
                  at_modifier?: number;
                  opponent_pa_modifier?: number;
                  damage_bonus?: number;
              })
            : null;
    if (maneuver) {
        const eligibility = evaluateManeuverEligibility({
            learned: maneuverLearned,
            weaponType: att.weaponType,
            maneuverActionType: maneuver.action_type,
            maneuverType: maneuverRules?.type,
            prerequisites:
                maneuver.prerequisites && typeof maneuver.prerequisites === 'object'
                    ? (maneuver.prerequisites as Record<string, unknown>)
                    : null,
            attributes: att.attributes,
            combatValue: att.at,
            handsFree: att.handsFree,
            combatTechnique: att.combatTechnique,
            learnedAbilityNames: attacker.type === 'PLAYER' ? att.learnedAbilityNames : [],
        });
        if (!eligibility.available) {
            throw httpError(
                eligibility.reasonCode === 'NOT_LEARNED' ? 403 : 400,
                `${maneuver.name} is unavailable: ${eligibility.reasonCode}${eligibility.detail ? ` (${eligibility.detail})` : ''}`
            );
        }
    }
    let atValue = att.at - calculateWoundPenalty(attacker.wounds) + attackerEffectState.modifiers.atModifier;
    const defensePenalty = getMultipleDefensePenalty(target.defense_count, tar.defensePenaltyStep);
    let paValue =
        tar.pa - calculateWoundPenalty(target.wounds) + targetEffectState.modifiers.paModifier - defensePenalty;
    let damageBonus = 0;
    let maneuverType: string | null = null;
    if (maneuverRules) {
        const r = maneuverRules;
        maneuverType = r.type ?? null;
        if (r.at_modifier) atValue += r.at_modifier;
        if (r.opponent_pa_modifier) paValue += r.opponent_pa_modifier;
        if (r.damage_bonus) damageBonus += r.damage_bonus;
    }

    if (maneuverType === 'disarm') {
        if (!target.player_id || !tar.weaponId) throw httpError(400, 'Entwaffnen requires a target with a weapon');
        if (tar.isShield) throw httpError(400, 'Entwaffnen cannot disarm a shield');
        if (tar.isTwoHanded) atValue -= 2;
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
        const rangeModifiers = getRangedBandModifiers(rangeBand);
        atValue += rangeModifiers.attack - coverPenalty;
        damageBonus += rangeModifiers.damage;
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
        const sizeOrder = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4 } as const;
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

    if (target.creature_size === 'tiny') atValue -= 4;

    if (attackKind === 'opportunity') atValue -= 4;
    atValue = Math.max(0, atValue);
    paValue = Math.max(0, paValue);

    const attack =
        input.preparedAttack ??
        (attackKind === 'opportunity'
            ? (() => {
                  const roll = rollDice(20);
                  return { roll, confirmRoll: null, outcome: roll <= atValue ? 'NORMAL_HIT' : 'NORMAL_MISS' };
              })()
            : resolveAttack(atValue));
    const rulesAttackKind =
        attackKind === 'opportunity'
            ? ('OPPORTUNITY' as const)
            : att.weaponType === 'RANGED'
              ? input.rangedAttackType === 'thrown'
                  ? ('RANGED_THROWN' as const)
                  : ('RANGED_SHOT' as const)
              : ('MELEE' as const);
    const defenseOptions = evaluateDefenseOptions({
        attackKind: rulesAttackKind,
        attackOutcome: attack.outcome as 'CRITICAL_SUCCESS' | 'NORMAL_HIT' | 'NORMAL_MISS' | 'BOTCH',
        defenseCount: target.defense_count,
        penaltyStep: tar.defensePenaltyStep,
        parryValue: tar.pa + targetEffectState.modifiers.paModifier - calculateWoundPenalty(target.wounds),
        dodgeValue: tar.dodge + targetEffectState.modifiers.checkModifier - calculateWoundPenalty(target.wounds),
        hasParryWeapon: tar.hasParryWeapon,
        hasShield: tar.hasShield,
        targetAlive: target.current_hp > 0 && !isIncapacitatedByWounds(target.wounds),
        defenseProhibited: targetEffectState.modifiers.prohibitsDefense,
        maneuverProhibitsDefense: attackKind === 'opportunity',
        ongoingLongAction: Boolean(target.ongoing_action),
        attackerSize: attacker.creature_size as CreatureSize,
    });
    paValue = defenseOptions.find(option => option.choice === 'PARRY')?.effectiveValue ?? 0;
    const requiresDecision = defenseOptions.some(option => option.choice !== 'DECLINE' && option.available);
    if (input.preparationOnly) {
        return {
            input: {
                sessionId: input.sessionId,
                attackerId: input.attackerId,
                targetId: input.targetId,
                maneuverId: input.maneuverId ?? null,
                attackKind: input.attackKind,
                rangedAttackType: input.rangedAttackType,
                hitZone: input.hitZone ?? null,
                distance: input.distance ?? null,
                coverPenalty: input.coverPenalty,
                weaponId: input.weaponId ?? null,
                attackAtModifier: input.attackAtModifier,
            },
            attacker: { id: attacker.id, name: attacker.name },
            target: { id: target.id, name: target.name },
            maneuverName: maneuver?.name ?? null,
            attack: { roll: attack.roll, confirmRoll: attack.confirmRoll, outcome: attack.outcome },
            atValue,
            defenseOptions,
            requiresDecision,
        };
    }
    let defense: AttackResultOut['defense'] = null;
    let selectedDefense: DefenseChoice | null = null;
    let hitConnected = false;
    let botchDamage = 0;

    if (attack.outcome === 'BOTCH') {
        botchDamage = Math.max(1, Math.floor(parseAndRollDamage(att.tp) / 2));
    } else if (attack.outcome === 'CRITICAL_SUCCESS') {
        hitConnected = true;
    } else if (attack.outcome === 'NORMAL_HIT' && attackKind !== 'opportunity') {
        selectedDefense =
            input.defenseChoice ??
            defenseOptions.find(option => option.choice !== 'DECLINE' && option.available)?.choice ??
            'DECLINE';
        const selectedOption = defenseOptions.find(option => option.choice === selectedDefense);
        if (!selectedOption?.available) {
            throw httpError(
                400,
                `Defense ${selectedDefense} is unavailable: ${selectedOption?.reasonCode ?? 'UNKNOWN'}`
            );
        }
        if (selectedDefense === 'DECLINE') {
            hitConnected = true;
        } else {
            const rolled = resolveDefense(selectedOption.effectiveValue ?? 0);
            defense = {
                choice: selectedDefense,
                value: selectedOption.effectiveValue ?? 0,
                roll: rolled.roll,
                success: rolled.success,
                interruptedLongAction: selectedOption.interruptsLongAction,
            };
            hitConnected = !defense.success;
        }
    } else if (attack.outcome === 'NORMAL_HIT') {
        hitConnected = true;
    }

    let rolledDamage = 0;
    let totalDamage = 0;
    let finalDamage = 0;
    if (hitConnected) {
        rolledDamage = parseAndRollDamage(maneuverType === 'disarm' ? '1w3' : att.tp);
        if (attack.outcome === 'CRITICAL_SUCCESS') rolledDamage *= 2;
        totalDamage = Math.max(0, rolledDamage + damageBonus);
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
        defenseChoice: selectedDefense,
        defenseOptions,
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

    const applyAttackMutations = async (tx: DbTx) => {
        if (miracleAtEffect) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, miracleAtEffect.id));
        }
        if (miraclePaEffect && defense?.choice === 'PARRY') {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, miraclePaEffect.id));
        }
        if (opportunityEffectId) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, opportunityEffectId));
        }
        if (defense) {
            await tx
                .update(combatants)
                .set({
                    defense_count: target.defense_count + 1,
                    ...(defense.interruptedLongAction ? { ongoing_action: null } : {}),
                })
                .where(eq(combatants.id, target.id));
            if (defense.interruptedLongAction) {
                await appendLog(tx, input.sessionId, `${target.name}'s longer action is interrupted by the defense.`);
            }
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
            if (!target.player_id || !tar.weaponId) return;
            const dropped = await tx
                .update(weapons)
                .set({
                    is_equipped: 'N',
                    equipped_slot: null,
                    is_dropped: true,
                    dropped_session_id: input.sessionId,
                    dropped_at: new Date(),
                })
                .where(
                    and(
                        eq(weapons.id, tar.weaponId),
                        eq(weapons.player_id, target.player_id),
                        eq(weapons.is_equipped, 'Y'),
                        eq(weapons.is_dropped, false)
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
    };
    if (input.transaction) await applyAttackMutations(input.transaction);
    else await db.transaction(applyAttackMutations);

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
        defenseChoice: selectedDefense,
        defenseOptions,
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

/**
 * Immediate resolver kept for compound/internal actions. Interactive and HTTP
 * entry points should use beginAttackAction + resolvePendingAttack so the
 * defender owns the choice.
 */
export async function resolveAttackAction(ctx: Ctx, input: AttackActionInput): Promise<AttackResultOut> {
    const result = await executeAttackAction(ctx, input);
    if ('requiresDecision' in result) throw httpError(500, 'Attack unexpectedly stopped in preparation');
    return result;
}

interface PendingAttackPayload extends Record<string, unknown> {
    attackInput: AttackActionInput;
    preparedAttack: PreparedAttack['attack'];
    defenseOptions: DefenseOption[];
    atValue: number;
    attackerName: string;
    targetName: string;
    maneuverName: string | null;
    followUp?: AttackActionInput | null;
}

function publicPendingAction(action: typeof combatActions.$inferSelect) {
    const payload = action.payload as PendingAttackPayload;
    return {
        id: action.id,
        sessionId: action.session_id,
        attackerId: action.actor_id,
        targetId: action.target_id,
        status: action.status,
        attack: payload.preparedAttack,
        atValue: payload.atValue,
        attackerName: payload.attackerName,
        targetName: payload.targetName,
        maneuverName: payload.maneuverName,
        defenseOptions: payload.defenseOptions,
        expiresAt: action.expires_at,
        version: action.version,
    };
}

export type BeginAttackResult =
    | { status: 'PENDING'; actionId: string; pending: ReturnType<typeof publicPendingAction>; result: null }
    | { status: 'RESOLVED'; actionId: string; pending: null; result: AttackResultOut };

/** Roll and validate once, then either persist defender choice or atomically finalize an unopposed result. */
export async function beginAttackAction(
    ctx: Ctx,
    input: AttackActionInput,
    internal: { consumeAction?: boolean } = {}
): Promise<BeginAttackResult> {
    const consumesAction = (input.attackKind ?? 'standard') === 'standard' && internal.consumeAction !== false;
    const prepared = await executeAttackAction(ctx, {
        ...input,
        preparationOnly: true,
        ignoreActionSpent: !consumesAction,
    });
    if (!('requiresDecision' in prepared)) throw httpError(500, 'Attack preparation returned a final result');
    const expiresAt = new Date(Date.now() + 15 * 60_000);

    return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.sessionId}:${input.attackerId}`}))`);
        const [existing] = await tx
            .select()
            .from(combatActions)
            .where(
                and(
                    eq(combatActions.session_id, input.sessionId),
                    eq(combatActions.actor_id, input.attackerId),
                    eq(combatActions.action_type, 'ATTACK'),
                    inArray(combatActions.status, ['PENDING', 'RESOLVING'])
                )
            )
            .limit(1);
        if (existing) throw httpError(409, `Attack ${existing.id} is already awaiting resolution`);

        if (consumesAction) {
            const [spent] = await tx
                .update(combatants)
                .set({ action_spent: true, updated_at: new Date() })
                .where(and(eq(combatants.id, input.attackerId), eq(combatants.action_spent, false)))
                .returning({ id: combatants.id });
            if (!spent) throw httpError(409, 'The active action was already spent');
        }

        const payload: PendingAttackPayload = {
            attackInput: prepared.input,
            preparedAttack: prepared.attack,
            defenseOptions: prepared.defenseOptions,
            atValue: prepared.atValue,
            attackerName: prepared.attacker.name,
            targetName: prepared.target.name,
            maneuverName: prepared.maneuverName,
        };
        const [action] = await tx
            .insert(combatActions)
            .values({
                session_id: input.sessionId,
                actor_id: input.attackerId,
                target_id: input.targetId,
                action_kind: consumesAction ? 'ACTION' : 'SYSTEM_REACTION',
                action_type: 'ATTACK',
                status: prepared.requiresDecision ? 'PENDING' : 'RESOLVING',
                payload,
                expires_at: expiresAt,
            })
            .returning();

        if (prepared.requiresDecision) {
            const offered = prepared.defenseOptions
                .filter(option => option.available)
                .map(option => option.choice)
                .join('/');
            await appendLog(
                tx,
                input.sessionId,
                `${prepared.attacker.name} attacks ${prepared.target.name} (${prepared.attack.roll}/${prepared.atValue}); waiting for defense (${offered}).`
            );
            return { status: 'PENDING', actionId: action.id, pending: publicPendingAction(action), result: null };
        }

        const result = await executeAttackAction(ctx, {
            ...prepared.input,
            preparedAttack: prepared.attack,
            defenseChoice: 'DECLINE',
            transaction: tx,
        });
        if ('requiresDecision' in result) throw httpError(500, 'Finalization returned a prepared attack');
        await tx
            .update(combatActions)
            .set({
                status: 'RESOLVED',
                decision: 'DECLINE',
                decision_by_discord_id: ctx.discordId,
                result: result as unknown as Record<string, unknown>,
                resolved_at: new Date(),
                updated_at: new Date(),
                version: action.version + 1,
            })
            .where(eq(combatActions.id, action.id));
        return { status: 'RESOLVED', actionId: action.id, pending: null, result };
    });
}

export async function getPendingAttack(ctx: Ctx, input: { sessionId: string; actionId?: string }) {
    const conditions = [eq(combatActions.session_id, input.sessionId), eq(combatActions.action_type, 'ATTACK')];
    if (input.actionId) conditions.push(eq(combatActions.id, input.actionId));
    const [action] = await db
        .select()
        .from(combatActions)
        .where(and(...conditions, inArray(combatActions.status, ['PENDING', 'RESOLVING'])))
        .orderBy(desc(combatActions.created_at))
        .limit(1);
    if (!action) throw httpError(404, 'No pending attack found');
    const { session, combatants: rows } = await loadSession(input.sessionId);
    const target = rows.find(row => row.id === action.target_id);
    const canView = session.dm_user_id === ctx.discordId || target?.discord_user_id === ctx.discordId;
    if (!canView) throw httpError(403, 'Only the defender or combat DM may inspect this pending attack');
    return publicPendingAction(action);
}

/** Claim one pending action and atomically persist its damage/effects/result. */
export async function resolvePendingAttack(
    ctx: Ctx,
    input: { actionId: string; decision: DefenseChoice; force?: boolean; sessionId?: string }
): Promise<{ alreadyResolved: boolean; result: AttackResultOut; nextAttack?: BeginAttackResult | null }> {
    if (!['PARRY', 'DODGE', 'DECLINE'].includes(input.decision)) throw httpError(400, 'Invalid defense decision');
    const [initial] = await db.select().from(combatActions).where(eq(combatActions.id, input.actionId)).limit(1);
    if (!initial || initial.action_type !== 'ATTACK') throw httpError(404, 'Pending attack not found');
    if (input.sessionId && initial.session_id !== input.sessionId)
        throw httpError(400, 'Pending attack session mismatch');
    const { session, combatants: rows } = await loadSession(initial.session_id);
    const target = rows.find(row => row.id === initial.target_id);
    const attacker = rows.find(row => row.id === initial.actor_id);
    const isDm = session.dm_user_id === ctx.discordId;
    const ownsTarget = target?.type === 'PLAYER' && target.discord_user_id === ctx.discordId;
    if (!isDm && !ownsTarget) throw httpError(403, 'Only the defender or combat DM may choose this defense');
    if (input.force && !isDm) throw httpError(403, 'Only the combat DM may force a pending resolution');
    if (initial.status === 'RESOLVED' && initial.result) {
        return { alreadyResolved: true, result: initial.result as unknown as AttackResultOut };
    }
    if (initial.status === 'CANCELLED') throw httpError(409, 'This attack was cancelled');
    if (initial.expires_at && initial.expires_at < new Date() && !input.force) {
        throw httpError(410, 'This defense prompt expired; the combat DM can force a resolution');
    }

    const staleClaim = new Date(Date.now() - 2 * 60_000);
    if (!attacker) throw httpError(409, 'The attacking combatant no longer exists');
    const resolutionCtx: Ctx = {
        discordId:
            attacker.type === 'PLAYER' && attacker.discord_user_id ? attacker.discord_user_id : session.dm_user_id,
    };
    const result = await db.transaction(async tx => {
        const [claimed] = await tx
            .update(combatActions)
            .set({ status: 'RESOLVING', updated_at: new Date(), version: sql`${combatActions.version} + 1` })
            .where(
                and(
                    eq(combatActions.id, input.actionId),
                    or(
                        eq(combatActions.status, 'PENDING'),
                        and(eq(combatActions.status, 'RESOLVING'), lt(combatActions.updated_at, staleClaim))
                    )
                )
            )
            .returning();
        if (!claimed) {
            const [current] = await tx
                .select({ status: combatActions.status, result: combatActions.result })
                .from(combatActions)
                .where(eq(combatActions.id, input.actionId));
            if (current?.status === 'RESOLVED' && current.result) {
                return { alreadyResolved: true, result: current.result as unknown as AttackResultOut };
            }
            throw httpError(409, 'This defense is already being resolved; retry shortly');
        }
        const payload = claimed.payload as PendingAttackPayload;
        const finalized = await executeAttackAction(resolutionCtx, {
            ...payload.attackInput,
            preparedAttack: payload.preparedAttack,
            defenseChoice: input.decision,
            transaction: tx,
        });
        if ('requiresDecision' in finalized) throw httpError(500, 'Finalization returned a prepared attack');
        await tx
            .update(combatActions)
            .set({
                status: 'RESOLVED',
                decision: input.decision,
                decision_by_discord_id: ctx.discordId,
                result: finalized as unknown as Record<string, unknown>,
                resolved_at: new Date(),
                updated_at: new Date(),
                version: sql`${combatActions.version} + 1`,
            })
            .where(eq(combatActions.id, input.actionId));
        return { alreadyResolved: false, result: finalized };
    });
    if (result.alreadyResolved) return result;
    const payload = initial.payload as PendingAttackPayload;
    const followUp = payload.followUp;
    const sharedTargetDefeated = followUp?.targetId === result.result.target.id && result.result.targetHpAfter <= 0;
    if (!followUp || result.result.attack.outcome === 'BOTCH' || sharedTargetDefeated) {
        return { ...result, nextAttack: null };
    }
    const continuationCtx: Ctx = {
        discordId:
            attacker.type === 'PLAYER' && attacker.discord_user_id ? attacker.discord_user_id : session.dm_user_id,
    };
    const nextAttack = await beginAttackAction(continuationCtx, followUp, { consumeAction: false });
    return { ...result, nextAttack };
}

export interface TwoWeaponAttackResult {
    status: 'PENDING' | 'RESOLVED';
    penalty: number;
    offHandPenalty: number;
    attacks: AttackResultOut[];
    pending: ReturnType<typeof publicPendingAction> | null;
    secondAttackSkipped: boolean;
    skipReason: string | null;
}

/** Begin the paired attacks of Beidhändiger Kampf as one action with independent defender choices. */
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

    const followUp: AttackActionInput = {
        sessionId: input.sessionId,
        attackerId: attacker.id,
        targetId: secondTargetId,
        weaponId: secondWeapon.id,
        attackAtModifier: offHandPenalty,
    };
    const first = await beginAttackAction(ctx, {
        sessionId: input.sessionId,
        attackerId: attacker.id,
        targetId: input.targetIds[0],
        weaponId: equipment.weaponId,
        attackAtModifier: penalty,
    });
    if (first.status === 'PENDING') {
        const [action] = await db.select().from(combatActions).where(eq(combatActions.id, first.actionId)).limit(1);
        if (!action) throw httpError(500, 'Two-weapon pending action was not persisted');
        await db
            .update(combatActions)
            .set({ payload: { ...(action.payload as PendingAttackPayload), followUp }, updated_at: new Date() })
            .where(and(eq(combatActions.id, action.id), eq(combatActions.status, 'PENDING')));
        return {
            status: 'PENDING',
            penalty,
            offHandPenalty,
            attacks: [],
            pending: first.pending,
            secondAttackSkipped: false,
            skipReason: null,
        };
    }
    if (first.result.attack.outcome === 'BOTCH') {
        return {
            status: 'RESOLVED',
            penalty,
            offHandPenalty,
            attacks: [first.result],
            pending: null,
            secondAttackSkipped: true,
            skipReason: 'The first attack botched',
        };
    }
    if (first.result.target.id === secondTargetId && first.result.targetHpAfter <= 0) {
        return {
            status: 'RESOLVED',
            penalty,
            offHandPenalty,
            attacks: [first.result],
            pending: null,
            secondAttackSkipped: true,
            skipReason: 'The shared target was defeated by the first attack',
        };
    }

    const second = await beginAttackAction(ctx, followUp, { consumeAction: false });
    return {
        status: second.status,
        penalty,
        offHandPenalty,
        attacks: second.status === 'RESOLVED' ? [first.result, second.result] : [first.result],
        pending: second.pending,
        secondAttackSkipped: false,
        skipReason: null,
    };
}

interface LogInput {
    attackerName: string;
    targetName: string;
    maneuverName: string | null;
    atValue: number;
    attack: { roll: number; confirmRoll: number | null; outcome: string };
    defense: AttackResultOut['defense'];
    defenseChoice: DefenseChoice | null;
    defenseOptions: DefenseOption[];
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
            const label = i.defense.choice === 'DODGE' ? 'Dodge' : 'Parry';
            m += ` | Offered: ${i.defenseOptions
                .filter(option => option.available)
                .map(option => option.choice)
                .join('/')}. ${i.targetName} ${label}: ${i.defense.roll}/${i.defense.value}.`;
            m += i.defense.success ? ` **Defended!**` : ` ${label} failed.`;
        } else if (i.defenseChoice === 'DECLINE') {
            m += ` | ${i.targetName} takes the hit without defending.`;
        } else {
            const unavailable = i.defenseOptions
                .filter(option => option.choice !== 'DECLINE')
                .map(option => `${option.choice}:${option.reasonCode}`)
                .join(', ');
            if (unavailable) m += ` | No defense (${unavailable}).`;
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
