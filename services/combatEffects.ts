/** Persistent combat conditions, statuses, buffs/stances, and lifecycle ticks. */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
    combatantConditions,
    combatantEffects,
    combatantStatuses,
    combatants,
    combatSessions,
    playerTalents,
    stats,
    supernaturalEffects,
    talents,
} from '../db/schema';
import { httpError } from '../db/operations/errors';
import {
    calculateCombatModifiers,
    getStatusDamage,
    isConditionType,
    isDurationType,
    isStatusType,
    nextDuration,
    progressStatusEffectData,
    statusData,
    validateStatusEffectData,
} from '../utils/combatEffectUtils';
import { calculatePainLevel } from '../utils/conditionUtils';
import { calculateEffectivePainLevel } from '../utils/woundUtils';
import { applyWoundDamage, calculateWoundPenalty } from '../utils/woundUtils';
import { rollDice } from '../utils/combatUtils';
import type { Ctx } from './_ctx';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CombatantRow = typeof combatants.$inferSelect;

export interface CombatantEffectState {
    conditions: (typeof combatantConditions.$inferSelect)[];
    statuses: (typeof combatantStatuses.$inferSelect)[];
    effects: (typeof combatantEffects.$inferSelect)[];
}

async function loadCombatantAndSession(combatantId: string) {
    const [row] = await db
        .select({ combatant: combatants, session: combatSessions })
        .from(combatants)
        .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
        .where(eq(combatants.id, combatantId))
        .limit(1);
    if (!row) throw httpError(404, 'Combatant not found');
    return row;
}

async function assertDm(ctx: Ctx, combatantId: string) {
    const row = await loadCombatantAndSession(combatantId);
    if (row.session.dm_user_id !== ctx.discordId) {
        throw httpError(403, 'Only the combat DM may change conditions, statuses, or effects');
    }
    return row;
}

export async function loadCombatantEffectState(combatantId: string): Promise<CombatantEffectState> {
    const [conditions, statuses, effects] = await Promise.all([
        db.select().from(combatantConditions).where(eq(combatantConditions.combatant_id, combatantId)),
        db.select().from(combatantStatuses).where(eq(combatantStatuses.combatant_id, combatantId)),
        db.select().from(combatantEffects).where(eq(combatantEffects.combatant_id, combatantId)),
    ]);
    return { conditions, statuses, effects };
}

export async function loadEffectsForCombatants(combatantIds: string[]) {
    if (combatantIds.length === 0) return new Map<string, CombatantEffectState>();
    const [conditions, statuses, effects] = await Promise.all([
        db.select().from(combatantConditions).where(inArray(combatantConditions.combatant_id, combatantIds)),
        db.select().from(combatantStatuses).where(inArray(combatantStatuses.combatant_id, combatantIds)),
        db.select().from(combatantEffects).where(inArray(combatantEffects.combatant_id, combatantIds)),
    ]);
    const result = new Map<string, CombatantEffectState>();
    for (const id of combatantIds) result.set(id, { conditions: [], statuses: [], effects: [] });
    for (const row of conditions) result.get(row.combatant_id)?.conditions.push(row);
    for (const row of statuses) result.get(row.combatant_id)?.statuses.push(row);
    for (const row of effects) result.get(row.combatant_id)?.effects.push(row);
    return result;
}

export async function getCombatantModifiers(combatant: CombatantRow) {
    const state = await loadCombatantEffectState(combatant.id);
    let painLevel = calculatePainLevel(combatant.current_hp, combatant.max_hp);
    let equipmentEncumbrance = 0;
    if (combatant.player_id) {
        const [row] = await db
            .select({
                suppression: stats.pain_suppression,
                modifier: stats.pain_modifier,
                encumbrance: stats.belastung,
            })
            .from(stats)
            .where(eq(stats.player_id, combatant.player_id))
            .limit(1);
        if (row) {
            painLevel = calculateEffectivePainLevel(painLevel, row.suppression, row.modifier);
            equipmentEncumbrance = row.encumbrance;
        }
    }
    const modifierConditions = state.conditions.map(condition => ({ ...condition }));
    const persistedEncumbrance = modifierConditions.find(condition => condition.condition_type === 'belastung');
    if (persistedEncumbrance) {
        persistedEncumbrance.level = Math.max(persistedEncumbrance.level, equipmentEncumbrance);
    } else if (equipmentEncumbrance > 0) {
        modifierConditions.push({
            condition_type: 'belastung',
            level: equipmentEncumbrance,
        } as (typeof modifierConditions)[number]);
    }
    return {
        state,
        painLevel,
        equipmentEncumbrance,
        modifiers: calculateCombatModifiers(modifierConditions, state.statuses, state.effects, painLevel),
        unencumberedCheckModifier: calculateCombatModifiers(
            modifierConditions.filter(condition => condition.condition_type !== 'belastung'),
            state.statuses,
            state.effects,
            painLevel
        ).checkModifier,
    };
}

export async function listConditions(_ctx: Ctx, combatantId: string) {
    await loadCombatantAndSession(combatantId);
    return db
        .select()
        .from(combatantConditions)
        .where(eq(combatantConditions.combatant_id, combatantId))
        .orderBy(combatantConditions.condition_type);
}

export async function applyCondition(
    ctx: Ctx,
    input: {
        combatantId: string;
        conditionType: string;
        level: number;
        source?: string | null;
        durationType?: string | null;
        durationRemaining?: number | null;
    }
) {
    await assertDm(ctx, input.combatantId);
    if (!isConditionType(input.conditionType)) throw httpError(400, 'Unsupported condition type');
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 4) {
        throw httpError(400, 'level must be an integer 1-4');
    }
    const durationType =
        input.durationType ?? (['betaeubung', 'ueberanstrengung'].includes(input.conditionType) ? 'rest' : null);
    if (durationType && !isDurationType(durationType)) throw httpError(400, 'Invalid durationType');
    const finiteDuration = durationType && !['permanent', 'rest'].includes(durationType);
    if (finiteDuration && (!Number.isInteger(input.durationRemaining) || (input.durationRemaining ?? 0) < 1)) {
        throw httpError(400, 'A positive durationRemaining is required for finite conditions');
    }
    if (!finiteDuration && input.durationRemaining !== undefined && input.durationRemaining !== null) {
        throw httpError(400, 'durationRemaining is only valid for rounds, minutes, or hours');
    }
    const [row] = await db
        .insert(combatantConditions)
        .values({
            combatant_id: input.combatantId,
            condition_type: input.conditionType,
            level: input.level,
            source: input.source ?? null,
            duration_type: durationType,
            duration_remaining: finiteDuration ? input.durationRemaining! : null,
        })
        .onConflictDoUpdate({
            target: [combatantConditions.combatant_id, combatantConditions.condition_type],
            set: {
                level: input.level,
                source: input.source ?? null,
                duration_type: durationType,
                duration_remaining: finiteDuration ? input.durationRemaining! : null,
                updated_at: new Date(),
            },
        })
        .returning();
    return row;
}

export async function removeCondition(ctx: Ctx, input: { combatantId: string; conditionType: string }) {
    await assertDm(ctx, input.combatantId);
    const [deleted] = await db
        .delete(combatantConditions)
        .where(
            and(
                eq(combatantConditions.combatant_id, input.combatantId),
                eq(combatantConditions.condition_type, input.conditionType)
            )
        )
        .returning({ id: combatantConditions.id });
    if (!deleted) throw httpError(404, 'Condition not found on combatant');
    return { deleted: true };
}

/** Owner/DM resistance entry point for Furcht using the learned Willenskraft probe. */
export async function resistCondition(
    ctx: Ctx,
    input: { combatantId: string; conditionType: 'furcht'; modifier?: number }
) {
    const { combatant, session } = await loadCombatantAndSession(input.combatantId);
    if (session.dm_user_id !== ctx.discordId && combatant.discord_user_id !== ctx.discordId) {
        throw httpError(403, 'Only the combatant owner or combat DM may roll resistance');
    }
    if (input.conditionType !== 'furcht') throw httpError(400, 'Only Furcht has a resistance action');
    if (!combatant.player_id) throw httpError(400, 'NPC resistance requires a DM-authored value');
    const modifier = input.modifier ?? 0;
    if (!Number.isInteger(modifier) || modifier < -20 || modifier > 20) {
        throw httpError(400, 'modifier must be an integer from -20 to 20');
    }
    const [condition] = await db
        .select()
        .from(combatantConditions)
        .where(
            and(
                eq(combatantConditions.combatant_id, combatant.id),
                eq(combatantConditions.condition_type, input.conditionType)
            )
        )
        .limit(1);
    if (!condition) throw httpError(404, 'Condition not found on combatant');
    const [sheet] = await db
        .select({ stats, ftw: playerTalents.ftw, stat1: talents.stat1, stat2: talents.stat2, stat3: talents.stat3 })
        .from(stats)
        .innerJoin(playerTalents, eq(playerTalents.player_id, stats.player_id))
        .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
        .where(and(eq(stats.player_id, combatant.player_id), eq(talents.name, 'Willenskraft')))
        .limit(1);
    if (!sheet) throw httpError(400, 'Combatant has no Willenskraft talent');
    const attrCodes = [sheet.stat1, sheet.stat2, sheet.stat3] as [string, string, string];
    const woundPenalty = calculateWoundPenalty(combatant.wounds);
    const conditionModifier = (await getCombatantModifiers(combatant)).modifiers.checkModifier;
    const attrValues = attrCodes.map(code =>
        Math.max(
            0,
            ((sheet.stats as Record<string, number>)[code.toLowerCase()] || 8) - woundPenalty + conditionModifier
        )
    ) as [number, number, number];
    const rolls = [rollDice(20), rollDice(20), rollDice(20)] as [number, number, number];
    let remainingFtw = sheet.ftw + modifier;
    for (let index = 0; index < rolls.length; index += 1) {
        remainingFtw -= Math.max(0, rolls[index] - attrValues[index]);
    }
    const success = remainingFtw >= 0;
    const qualityLevel = !success
        ? 0
        : remainingFtw >= 16
          ? 6
          : remainingFtw >= 13
            ? 5
            : remainingFtw >= 10
              ? 4
              : remainingFtw >= 7
                ? 3
                : remainingFtw >= 4
                  ? 2
                  : 1;
    if (success) {
        if (condition.level <= 1) {
            await db.delete(combatantConditions).where(eq(combatantConditions.id, condition.id));
        } else {
            await db
                .update(combatantConditions)
                .set({ level: condition.level - 1, updated_at: new Date() })
                .where(eq(combatantConditions.id, condition.id));
        }
    }
    return {
        conditionType: input.conditionType,
        rolls,
        success,
        qualityLevel,
        conditionModifier,
        levelBefore: condition.level,
        levelAfter: success ? Math.max(0, condition.level - 1) : condition.level,
    };
}

export async function listStatuses(_ctx: Ctx, combatantId: string) {
    await loadCombatantAndSession(combatantId);
    return db
        .select()
        .from(combatantStatuses)
        .where(eq(combatantStatuses.combatant_id, combatantId))
        .orderBy(combatantStatuses.status_type);
}

export async function applyStatus(
    ctx: Ctx,
    input: {
        combatantId: string;
        statusType: string;
        source?: string | null;
        durationRounds?: number | null;
        effectData?: unknown;
    }
) {
    await assertDm(ctx, input.combatantId);
    if (!isStatusType(input.statusType)) throw httpError(400, 'Unsupported status type');
    if (
        input.durationRounds !== undefined &&
        input.durationRounds !== null &&
        (!Number.isInteger(input.durationRounds) || input.durationRounds < 1)
    ) {
        throw httpError(400, 'durationRounds must be a positive integer or null');
    }
    let effectData;
    try {
        effectData = validateStatusEffectData(input.effectData);
    } catch (error) {
        throw httpError(400, error instanceof Error ? error.message : 'Invalid effectData');
    }
    const [row] = await db
        .insert(combatantStatuses)
        .values({
            combatant_id: input.combatantId,
            status_type: input.statusType,
            source: input.source ?? null,
            duration_rounds: input.durationRounds ?? null,
            effect_data: effectData,
        })
        .onConflictDoUpdate({
            target: [combatantStatuses.combatant_id, combatantStatuses.status_type],
            set: {
                source: input.source ?? null,
                duration_rounds: input.durationRounds ?? null,
                effect_data: effectData,
                updated_at: new Date(),
            },
        })
        .returning();
    return row;
}

export async function removeStatus(ctx: Ctx, input: { combatantId: string; statusType: string }) {
    await assertDm(ctx, input.combatantId);
    const [deleted] = await db
        .delete(combatantStatuses)
        .where(
            and(
                eq(combatantStatuses.combatant_id, input.combatantId),
                eq(combatantStatuses.status_type, input.statusType)
            )
        )
        .returning({ id: combatantStatuses.id });
    if (!deleted) throw httpError(404, 'Status not found on combatant');
    return { deleted: true };
}

function validateModifier(name: string, value: number | undefined) {
    const normalized = value ?? 0;
    if (!Number.isInteger(normalized) || normalized < -20 || normalized > 20) {
        throw httpError(400, `${name} must be an integer from -20 to 20`);
    }
    return normalized;
}

export async function listEffects(_ctx: Ctx, combatantId: string) {
    await loadCombatantAndSession(combatantId);
    return db
        .select()
        .from(combatantEffects)
        .where(eq(combatantEffects.combatant_id, combatantId))
        .orderBy(combatantEffects.effect_type);
}

export async function applyEffect(
    ctx: Ctx,
    input: {
        combatantId: string;
        effectType: string;
        source?: string | null;
        atModifier?: number;
        paModifier?: number;
        damageModifier?: number;
        armorModifier?: number;
        checkModifier?: number;
        prohibitsActions?: boolean;
        prohibitsDefense?: boolean;
        durationRounds?: number | null;
    }
) {
    await assertDm(ctx, input.combatantId);
    if (!input.effectType || input.effectType.length > 80)
        throw httpError(400, 'effectType is required (max 80 chars)');
    if (
        input.durationRounds !== undefined &&
        input.durationRounds !== null &&
        (!Number.isInteger(input.durationRounds) || input.durationRounds < 1)
    ) {
        throw httpError(400, 'durationRounds must be a positive integer or null');
    }
    const values = {
        combatant_id: input.combatantId,
        effect_type: input.effectType,
        source: input.source ?? null,
        at_modifier: validateModifier('atModifier', input.atModifier),
        pa_modifier: validateModifier('paModifier', input.paModifier),
        damage_modifier: validateModifier('damageModifier', input.damageModifier),
        armor_modifier: validateModifier('armorModifier', input.armorModifier),
        check_modifier: validateModifier('checkModifier', input.checkModifier),
        prohibits_actions: input.prohibitsActions ?? false,
        prohibits_defense: input.prohibitsDefense ?? false,
        duration_rounds: input.durationRounds ?? null,
    };
    const [row] = await db
        .insert(combatantEffects)
        .values(values)
        .onConflictDoUpdate({
            target: [combatantEffects.combatant_id, combatantEffects.effect_type],
            set: { ...values, updated_at: new Date() },
        })
        .returning();
    return row;
}

export async function removeEffect(ctx: Ctx, input: { combatantId: string; effectType: string }) {
    await assertDm(ctx, input.combatantId);
    const [deleted] = await db
        .delete(combatantEffects)
        .where(
            and(
                eq(combatantEffects.combatant_id, input.combatantId),
                eq(combatantEffects.effect_type, input.effectType)
            )
        )
        .returning({ id: combatantEffects.id });
    if (!deleted) throw httpError(404, 'Effect not found on combatant');
    return { deleted: true };
}

export interface TurnTickResult {
    damage: number;
    expiredConditions: string[];
    expiredStatuses: string[];
    expiredEffects: string[];
    logEntries: string[];
}

export async function processTurnEnd(tx: Transaction, combatant: CombatantRow): Promise<TurnTickResult> {
    const [conditions, statuses] = await Promise.all([
        tx.select().from(combatantConditions).where(eq(combatantConditions.combatant_id, combatant.id)),
        tx.select().from(combatantStatuses).where(eq(combatantStatuses.combatant_id, combatant.id)),
    ]);
    const expiredConditions: string[] = [];
    const expiredStatuses: string[] = [];
    const logEntries: string[] = [];
    const damage = statuses.reduce((sum, status) => sum + getStatusDamage(status), 0);

    if (damage > 0) {
        const nextHp = combatant.current_hp - damage;
        const woundResult = applyWoundDamage(combatant.wounds, damage, combatant.wound_threshold);
        await tx
            .update(combatants)
            .set({ current_hp: nextHp, wounds: woundResult.totalWounds })
            .where(eq(combatants.id, combatant.id));
        if (combatant.player_id) {
            await tx
                .update(stats)
                .set({
                    le_current: nextHp,
                    wounds: woundResult.totalWounds,
                })
                .where(eq(stats.player_id, combatant.player_id));
        }
        logEntries.push(`${combatant.name} suffers ${damage} ongoing damage (${nextHp}/${combatant.max_hp} LeP).`);
        if (woundResult.woundsInflicted > 0) {
            logEntries.push(
                `${combatant.name} suffers ${woundResult.woundsInflicted} wound(s) from the ongoing damage ` +
                    `(${woundResult.totalWounds} total).`
            );
        }
    }

    for (const status of statuses) {
        const duration = nextDuration(status.duration_rounds);
        if (duration.expired) {
            await tx.delete(combatantStatuses).where(eq(combatantStatuses.id, status.id));
            expiredStatuses.push(status.status_type);
        } else {
            const progressedData = progressStatusEffectData(status);
            if (
                duration.remaining !== status.duration_rounds ||
                JSON.stringify(progressedData) !== JSON.stringify(statusData(status))
            ) {
                await tx
                    .update(combatantStatuses)
                    .set({
                        duration_rounds: duration.remaining,
                        effect_data: progressedData,
                        updated_at: new Date(),
                    })
                    .where(eq(combatantStatuses.id, status.id));
            }
        }
    }

    for (const condition of conditions.filter(row => row.duration_type === 'rounds')) {
        const duration = nextDuration(condition.duration_remaining);
        if (duration.expired) {
            await tx.delete(combatantConditions).where(eq(combatantConditions.id, condition.id));
            expiredConditions.push(condition.condition_type);
        } else if (duration.remaining !== condition.duration_remaining) {
            await tx
                .update(combatantConditions)
                .set({ duration_remaining: duration.remaining, updated_at: new Date() })
                .where(eq(combatantConditions.id, condition.id));
        }
    }
    const trackedEffects = await tx
        .select()
        .from(supernaturalEffects)
        .where(
            and(
                eq(supernaturalEffects.target_combatant_id, combatant.id),
                eq(supernaturalEffects.active, true),
                eq(supernaturalEffects.duration_type, 'rounds')
            )
        );
    for (const tracked of trackedEffects.filter(row => row.effect_type !== 'BUFF')) {
        const duration = nextDuration(tracked.duration_remaining);
        await tx
            .update(supernaturalEffects)
            .set({
                active: !duration.expired,
                duration_remaining: duration.remaining,
                updated_at: new Date(),
            })
            .where(eq(supernaturalEffects.id, tracked.id));
    }
    if (expiredConditions.length || expiredStatuses.length) {
        logEntries.push(`${combatant.name}: expired ${[...expiredConditions, ...expiredStatuses].join(', ')}.`);
    }
    return { damage, expiredConditions, expiredStatuses, expiredEffects: [], logEntries };
}

export async function processTurnStart(tx: Transaction, combatant: CombatantRow): Promise<TurnTickResult> {
    const effects = await tx.select().from(combatantEffects).where(eq(combatantEffects.combatant_id, combatant.id));
    const expiredEffects: string[] = [];
    for (const effect of effects) {
        const duration = nextDuration(effect.duration_rounds);
        if (duration.expired) {
            await tx.delete(combatantEffects).where(eq(combatantEffects.id, effect.id));
            expiredEffects.push(effect.effect_type);
            if (effect.effect_type.startsWith('ability:')) {
                await tx
                    .update(supernaturalEffects)
                    .set({ active: false, duration_remaining: 0, updated_at: new Date() })
                    .where(eq(supernaturalEffects.casting_id, effect.effect_type.slice('ability:'.length)));
            }
        } else if (duration.remaining !== effect.duration_rounds) {
            await tx
                .update(combatantEffects)
                .set({ duration_rounds: duration.remaining, updated_at: new Date() })
                .where(eq(combatantEffects.id, effect.id));
            if (effect.effect_type.startsWith('ability:')) {
                await tx
                    .update(supernaturalEffects)
                    .set({ duration_remaining: duration.remaining, updated_at: new Date() })
                    .where(eq(supernaturalEffects.casting_id, effect.effect_type.slice('ability:'.length)));
            }
        }
    }
    const logEntries = expiredEffects.length ? [`${combatant.name}: expired ${expiredEffects.join(', ')}.`] : [];
    return { damage: 0, expiredConditions: [], expiredStatuses: [], expiredEffects, logEntries };
}

export async function recoverRestConditionsForPlayer(tx: Transaction, playerId: number) {
    const rows = await tx
        .select({ condition: combatantConditions })
        .from(combatantConditions)
        .innerJoin(combatants, eq(combatantConditions.combatant_id, combatants.id))
        .where(and(eq(combatants.player_id, playerId), eq(combatantConditions.duration_type, 'rest')));
    if (rows.length > 0) {
        await tx.delete(combatantConditions).where(
            inArray(
                combatantConditions.id,
                rows.map(row => row.condition.id)
            )
        );
    }
    return rows.map(row => row.condition.condition_type);
}
