/**
 * Heilkunde Wunden applications over the shared character/combat persistence.
 * The service owns validation, authorization, probe resolution, effects, and
 * the immutable treatment audit row. Discord and HTTP are presentation layers.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
    combatSessions,
    combatants,
    combatantStatuses,
    players,
    playerTalents,
    stats,
    talents,
    woundTreatments,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import { rollDice } from '../utils/rollUtil';
import {
    applyWoundDamage,
    calculateBleedingReduction,
    calculatePromotedHealing,
    calculateWoundPenalty,
    calculateWoundThreshold,
} from '../utils/woundUtils';
import { evaluateProbe } from './talents';
import { getCharacterSheet } from './characters';
import type { Ctx } from './_ctx';

export type WoundTreatmentType = 'healing' | 'pain' | 'stabilize' | 'bleeding';

const TREATMENT_TYPES = new Set<WoundTreatmentType>(['healing', 'pain', 'stabilize', 'bleeding']);

interface TreatmentInput {
    treatmentType: WoundTreatmentType;
    targetPlayerId?: number;
    combatantId?: string;
    modifier?: number;
}

async function loadTarget(ctx: Ctx, healerPlayerId: number, input: TreatmentInput) {
    const targetPlayerId = input.targetPlayerId ?? healerPlayerId;
    if (!Number.isInteger(targetPlayerId) || targetPlayerId <= 0) {
        throw httpError(400, 'targetPlayerId must be a positive integer');
    }

    const [target] = await db
        .select({ player: players, stats })
        .from(players)
        .innerJoin(stats, eq(stats.player_id, players.id))
        .where(eq(players.id, targetPlayerId))
        .limit(1);
    if (!target) throw httpError(404, 'Treatment target not found');

    let combatant: typeof combatants.$inferSelect | null = null;
    if (input.combatantId) {
        const [combatRow] = await db
            .select({ combatant: combatants, dm_user_id: combatSessions.dm_user_id })
            .from(combatants)
            .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
            .where(eq(combatants.id, input.combatantId))
            .limit(1);
        if (!combatRow) throw httpError(404, 'Combatant not found');
        if (combatRow.combatant.player_id !== targetPlayerId) {
            throw httpError(400, 'Combatant does not belong to the treatment target');
        }
        const ownsCombatant = combatRow.combatant.discord_user_id === ctx.discordId;
        const isCombatDm = combatRow.dm_user_id === ctx.discordId;
        const [callerCombatant] = await db
            .select({ id: combatants.id })
            .from(combatants)
            .where(
                and(
                    eq(combatants.session_id, combatRow.combatant.session_id),
                    eq(combatants.discord_user_id, ctx.discordId)
                )
            )
            .limit(1);
        if (!ownsCombatant && !isCombatDm && !callerCombatant) {
            throw httpError(403, 'Only a combat participant, the target, or the combat DM may apply treatment');
        }
        combatant = combatRow.combatant;
    } else if (targetPlayerId !== healerPlayerId && ctx.role !== 'DM') {
        throw httpError(403, 'Treating another character requires DM authorization or an active combat target');
    }

    return { ...target, combatant };
}

async function loadHealingTalent(playerId: number) {
    const [learned] = await db
        .select({
            ftw: playerTalents.ftw,
            stat1: talents.stat1,
            stat2: talents.stat2,
            stat3: talents.stat3,
        })
        .from(playerTalents)
        .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
        .where(and(eq(playerTalents.player_id, playerId), eq(talents.name, 'Heilkunde: Wunden')))
        .limit(1);
    if (!learned) throw httpError(400, 'Healer has no Heilkunde: Wunden talent');
    return learned;
}

export interface WoundTreatmentResult {
    treatmentType: WoundTreatmentType;
    healerName: string;
    targetName: string;
    modifier: number;
    rolls: [number, number, number];
    success: boolean;
    criticalSuccess: boolean;
    fumble: boolean;
    qualityLevel: number;
    pendingHealingBonus: number;
    painSuppression: number;
    painSuppressionPhases: number;
    lifePointsBefore: number;
    lifePointsAfter: number;
    woundsBefore: number;
    woundsAfter: number;
    bleedingRoundsBefore: number | null;
    bleedingRoundsAfter: number | null;
}

export async function treatWounds(ctx: Ctx, input: TreatmentInput): Promise<WoundTreatmentResult> {
    if (!TREATMENT_TYPES.has(input.treatmentType)) throw httpError(400, 'Invalid wound treatment type');
    const requestedModifier = input.modifier ?? 0;
    if (!Number.isInteger(requestedModifier) || requestedModifier < -20 || requestedModifier > 20) {
        throw httpError(400, 'modifier must be an integer from -20 to 20');
    }

    const { player: healer, stats: healerStats } = await getCharacterSheet(ctx);
    if (!healerStats) throw httpError(400, 'Healer has no stats set');
    const learned = await loadHealingTalent(healer.id);
    const target = await loadTarget(ctx, healer.id, input);

    let effectiveModifier = requestedModifier;
    if (input.treatmentType === 'bleeding') effectiveModifier += 2;
    if (input.treatmentType === 'stabilize') {
        if (target.stats.le_current > 0) throw httpError(400, 'Target does not need stabilization');
        if (target.stats.le_current <= -target.stats.ko) throw httpError(400, 'Target is beyond stabilization');
        effectiveModifier -= Math.floor(Math.abs(target.stats.le_current) / 2) + target.stats.stabilization_failures;
    }

    let bleedingStatus: typeof combatantStatuses.$inferSelect | null = null;
    if (input.treatmentType === 'bleeding') {
        if (!target.combatant) throw httpError(400, 'Bleeding treatment requires a combatant target');
        [bleedingStatus] = await db
            .select()
            .from(combatantStatuses)
            .where(
                and(
                    eq(combatantStatuses.combatant_id, target.combatant.id),
                    eq(combatantStatuses.status_type, 'blutend')
                )
            )
            .limit(1);
        if (!bleedingStatus) throw httpError(404, 'Target is not bleeding');
    }

    const woundPenalty = calculateWoundPenalty(healerStats.wounds);
    const attrCodes = [learned.stat1, learned.stat2, learned.stat3] as [string, string, string];
    const attrValues = attrCodes.map(code => {
        const raw = (healerStats as Record<string, number>)[code.toLowerCase()] || 8;
        return Math.max(0, raw - woundPenalty);
    }) as [number, number, number];
    const rolls = [rollDice(20), rollDice(20), rollDice(20)] as [number, number, number];
    const evaluated = evaluateProbe({
        attrCodes,
        attrValues,
        baseFtw: learned.ftw,
        modifier: effectiveModifier,
        rolls,
    });
    const criticalSuccess = rolls.filter(roll => roll === 1).length >= 2;
    const fumble = rolls.filter(roll => roll === 20).length >= 2;
    const success = criticalSuccess || (!fumble && evaluated.success);
    const qualityLevel = success ? (criticalSuccess ? 6 : evaluated.qs) : 0;

    const lifePointsBefore = target.stats.le_current;
    const woundsBefore = target.stats.wounds;
    let lifePointsAfter = lifePointsBefore;
    let woundsAfter = woundsBefore;
    let pendingHealingBonus = target.stats.pending_healing_bonus;
    let painSuppression = target.stats.pain_suppression;
    let painSuppressionPhases = target.stats.pain_suppression_phases;
    let bleedingRoundsAfter = bleedingStatus?.duration_rounds ?? null;
    const targetUpdates: Record<string, number> = {};

    if (input.treatmentType === 'healing') {
        if (fumble) {
            const damage = rollDice(6);
            lifePointsAfter -= damage;
            const threshold = calculateWoundThreshold(target.stats.ko, target.stats.wound_threshold_modifier);
            woundsAfter = applyWoundDamage(woundsBefore, damage, threshold).totalWounds;
            targetUpdates.le_current = lifePointsAfter;
            targetUpdates.wounds = woundsAfter;
        } else if (success) {
            pendingHealingBonus = Math.max(
                pendingHealingBonus,
                calculatePromotedHealing(qualityLevel, learned.ftw, criticalSuccess)
            );
            targetUpdates.pending_healing_bonus = pendingHealingBonus;
        }
    } else if (input.treatmentType === 'pain') {
        if (fumble) {
            targetUpdates.pain_modifier = target.stats.pain_modifier + 1;
        } else if (success) {
            painSuppression = Math.max(painSuppression, Math.min(4, qualityLevel));
            painSuppressionPhases = Math.max(painSuppressionPhases, criticalSuccess ? 2 : 1);
            targetUpdates.pain_suppression = painSuppression;
            targetUpdates.pain_suppression_phases = painSuppressionPhases;
        }
    } else if (input.treatmentType === 'stabilize') {
        if (success) {
            lifePointsAfter = 1;
            targetUpdates.le_current = 1;
            targetUpdates.stabilization_failures = 0;
        } else {
            targetUpdates.stabilization_failures = target.stats.stabilization_failures + 1;
        }
    } else if (input.treatmentType === 'bleeding' && success && bleedingStatus) {
        const reduction = calculateBleedingReduction(qualityLevel);
        if (bleedingStatus.duration_rounds !== null) {
            bleedingRoundsAfter = Math.max(0, bleedingStatus.duration_rounds - reduction);
        }
    }

    await db.transaction(async tx => {
        if (Object.keys(targetUpdates).length > 0) {
            await tx.update(stats).set(targetUpdates).where(eq(stats.id, target.stats.id));
        }

        if (target.combatant && (lifePointsAfter !== lifePointsBefore || woundsAfter !== woundsBefore)) {
            await tx
                .update(combatants)
                .set({ current_hp: lifePointsAfter, wounds: woundsAfter })
                .where(eq(combatants.id, target.combatant.id));
        } else if (!target.combatant && (lifePointsAfter !== lifePointsBefore || woundsAfter !== woundsBefore)) {
            const activeSessions = await tx
                .select({ id: combatSessions.id })
                .from(combatSessions)
                .where(inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED']));
            if (activeSessions.length > 0) {
                await tx
                    .update(combatants)
                    .set({ current_hp: lifePointsAfter, wounds: woundsAfter })
                    .where(
                        and(
                            eq(combatants.player_id, target.player.id),
                            inArray(
                                combatants.session_id,
                                activeSessions.map(session => session.id)
                            )
                        )
                    );
            }
        }

        if (input.treatmentType === 'bleeding' && bleedingStatus && success) {
            if (bleedingRoundsAfter !== null && bleedingRoundsAfter <= 0) {
                await tx.delete(combatantStatuses).where(eq(combatantStatuses.id, bleedingStatus.id));
            } else if (bleedingRoundsAfter !== bleedingStatus.duration_rounds) {
                await tx
                    .update(combatantStatuses)
                    .set({ duration_rounds: bleedingRoundsAfter, updated_at: new Date() })
                    .where(eq(combatantStatuses.id, bleedingStatus.id));
            }
        }

        await tx.insert(woundTreatments).values({
            target_player_id: target.player.id,
            healer_player_id: healer.id,
            combatant_id: target.combatant?.id ?? null,
            treatment_type: input.treatmentType,
            success,
            critical_success: criticalSuccess,
            fumble,
            quality_level: qualityLevel,
            life_points_changed: lifePointsAfter - lifePointsBefore,
            wounds_healed: Math.max(0, woundsBefore - woundsAfter),
        });
    });

    return {
        treatmentType: input.treatmentType,
        healerName: healer.name,
        targetName: target.player.name,
        modifier: effectiveModifier,
        rolls,
        success,
        criticalSuccess,
        fumble,
        qualityLevel,
        pendingHealingBonus,
        painSuppression,
        painSuppressionPhases,
        lifePointsBefore,
        lifePointsAfter,
        woundsBefore,
        woundsAfter,
        bleedingRoundsBefore: bleedingStatus?.duration_rounds ?? null,
        bleedingRoundsAfter,
    };
}
