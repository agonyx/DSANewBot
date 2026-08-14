/**
 * Resource & vitals services — Schicksalspunkte / Astralpunkte / Karmapunkte
 * (spend/restore/set/show), healing (LeP), and the Regenerationsphase. All
 * ctx-authenticated, throw HttpError on business failures, no discord.js.
 *
 * `targetDiscordId` (optional) lets a caller act on another character's selected
 * sheet (the commands expose a /target option). Authorization of cross-character
 * actions stays in the command/policy layer, as before.
 */
import { db } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { combatSessions, combatantConditions, combatants, players, stats } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { rollRegeneration } from '../utils/regenUtils';
import { calculateNaturalWoundHealing } from '../utils/woundUtils';
import type { Ctx } from './_ctx';
import { recoverRestConditionsForPlayer } from './combatEffects';

export type ResourceKey = 'schicksalspunkte' | 'asp' | 'kap';

interface ResourceMeta {
    key: ResourceKey;
    currentCol: string;
    maxCol: string;
    label: string;
    emoji: string;
    color: number;
}

/** Metadata for the three DSA 5 point pools. Presentation fields (label/emoji/color)
 *  are read by the Discord embed renderer; column fields drive the DB update. */
export const RESOURCE_TYPES: Record<ResourceKey, ResourceMeta> = {
    schicksalspunkte: {
        key: 'schicksalspunkte',
        currentCol: 'schicksalspunkte_current',
        maxCol: 'schicksalspunkte_max',
        label: 'Schicksalspunkte',
        emoji: '🎲',
        color: 0xffd700,
    },
    asp: {
        key: 'asp',
        currentCol: 'asp_current',
        maxCol: 'asp_max',
        label: 'Astralpunkte',
        emoji: '✨',
        color: 0x9b59b6,
    },
    kap: {
        key: 'kap',
        currentCol: 'kap_current',
        maxCol: 'kap_max',
        label: 'Karmapunkte',
        emoji: '🙏',
        color: 0xf1c40f,
    },
};

type StatsRow = typeof stats.$inferSelect;

function col(row: StatsRow, name: string): number {
    return (row as Record<string, number>)[name];
}

/** Load the selected character + stats for a Discord user (throws 404 if none). */
async function loadTargetSheet(discordId: string) {
    const [player] = await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')))
        .limit(1);
    if (!player) throw httpError(404, 'No selected character. Use /choose-character first.');
    const [statsRow] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
    if (!statsRow) throw httpError(404, 'Character has no stats set');
    return { player, stats: statsRow };
}

export interface ResourceSnapshot {
    characterName: string;
    type: ResourceKey;
    current: number;
    max: number;
}

export async function getResource(
    ctx: Ctx,
    input: { type: ResourceKey; targetDiscordId?: string }
): Promise<ResourceSnapshot> {
    const meta = RESOURCE_TYPES[input.type];
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);
    return {
        characterName: player.name,
        type: input.type,
        current: col(row, meta.currentCol),
        max: col(row, meta.maxCol),
    };
}

export interface ResourceMutation extends ResourceSnapshot {
    oldValue: number;
    newValue: number;
}

export async function spendResource(
    ctx: Ctx,
    input: { type: ResourceKey; amount: number; targetDiscordId?: string }
): Promise<ResourceMutation> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw httpError(400, 'amount must be a positive integer');
    const meta = RESOURCE_TYPES[input.type];
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);
    const max = col(row, meta.maxCol);
    const oldValue = col(row, meta.currentCol);
    if (max === 0) throw httpError(400, `This character has no ${meta.label} pool.`);
    if (oldValue < input.amount) {
        throw httpError(400, `Not enough ${meta.label}! (Current: ${oldValue}/${max})`);
    }
    const newValue = oldValue - input.amount;
    await db
        .update(stats)
        .set({ [meta.currentCol]: newValue })
        .where(eq(stats.id, row.id));
    return { characterName: player.name, type: input.type, oldValue, newValue, current: newValue, max };
}

export async function restoreResource(
    ctx: Ctx,
    input: { type: ResourceKey; amount: number; targetDiscordId?: string }
): Promise<ResourceMutation & { actualAmount: number }> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw httpError(400, 'amount must be a positive integer');
    const meta = RESOURCE_TYPES[input.type];
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);
    const max = col(row, meta.maxCol);
    const oldValue = col(row, meta.currentCol);
    const newValue = Math.min(oldValue + input.amount, max);
    const actualAmount = newValue - oldValue;
    if (actualAmount > 0) {
        await db
            .update(stats)
            .set({ [meta.currentCol]: newValue })
            .where(eq(stats.id, row.id));
    }
    return { characterName: player.name, type: input.type, oldValue, newValue, actualAmount, current: newValue, max };
}

export async function setResource(
    ctx: Ctx,
    input: { type: ResourceKey; value: number; targetDiscordId?: string }
): Promise<ResourceMutation> {
    if (!Number.isInteger(input.value) || input.value < 0) throw httpError(400, 'value must be a non-negative integer');
    const meta = RESOURCE_TYPES[input.type];
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);
    const max = col(row, meta.maxCol);
    const oldValue = col(row, meta.currentCol);
    const newValue = Math.max(0, Math.min(input.value, max));
    await db
        .update(stats)
        .set({ [meta.currentCol]: newValue })
        .where(eq(stats.id, row.id));
    return { characterName: player.name, type: input.type, oldValue, newValue, current: newValue, max };
}

export interface HealResult {
    characterName: string;
    oldValue: number;
    newValue: number;
    actualHeal: number;
    max: number;
}

/** Heal LeP (life points), capped at le_max. actualHeal is 0 if already full. */
export async function healCharacter(
    ctx: Ctx,
    input: { amount: number; targetDiscordId?: string }
): Promise<HealResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw httpError(400, 'amount must be a positive integer');
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);
    const max = row.le_max;
    const oldValue = row.le_current;
    const newValue = Math.min(oldValue + input.amount, max);
    const actualHeal = newValue - oldValue;
    if (actualHeal > 0) {
        await db.update(stats).set({ le_current: newValue }).where(eq(stats.id, row.id));
    }
    return { characterName: player.name, oldValue, newValue, actualHeal, max };
}

export interface RegenResult {
    characterName: string;
    alreadyFull: boolean;
    results: ReturnType<typeof rollRegeneration>['results'];
    woundsBefore: number;
    woundsHealed: number;
    woundsAfter: number;
    healingBonusApplied: number;
    painSuppressionExpired: boolean;
    recoveredConditions: string[];
    regenerationPenalty: number;
}

/** Perform a Regenerationsphase: roll 1W6 recovery for LeP (always) and AsP/KaP
 *  (only for spellcasters/blessed). Returns alreadyFull=true without rolling if
 *  every recoverable pool is already at max. */
export async function regenerate(ctx: Ctx, input: { targetDiscordId?: string } = {}): Promise<RegenResult> {
    const { player, stats: row } = await loadTargetSheet(input.targetDiscordId ?? ctx.discordId);

    const fullLe = row.le_current >= row.le_max;
    const fullAsp = row.asp_max === 0 || row.asp_current >= row.asp_max;
    const fullKap = row.kap_max === 0 || row.kap_current >= row.kap_max;
    const woundRecoveryPending = row.wounds > 0;
    const activeConditions = await db
        .select({
            id: combatantConditions.id,
            type: combatantConditions.condition_type,
            level: combatantConditions.level,
            durationType: combatantConditions.duration_type,
        })
        .from(combatantConditions)
        .innerJoin(combatants, eq(combatantConditions.combatant_id, combatants.id))
        .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
        .where(and(eq(combatants.player_id, player.id), inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED'])));
    const restConditions = activeConditions.filter(condition => condition.durationType === 'rest');
    const exhaustionLevel = activeConditions
        .filter(condition => condition.type === 'ueberanstrengung')
        .reduce((highest, condition) => Math.max(highest, condition.level), 0);
    const regenerationPenalty = exhaustionLevel >= 3 ? -2 : exhaustionLevel >= 2 ? -1 : 0;
    const treatmentStatePending =
        row.pending_healing_bonus > 0 ||
        row.pain_suppression > 0 ||
        row.pain_suppression_phases > 0 ||
        row.pain_modifier !== 0;
    if (
        fullLe &&
        fullAsp &&
        fullKap &&
        !woundRecoveryPending &&
        !treatmentStatePending &&
        restConditions.length === 0
    ) {
        return {
            characterName: player.name,
            alreadyFull: true,
            results: [],
            woundsBefore: row.wounds,
            woundsHealed: 0,
            woundsAfter: row.wounds,
            healingBonusApplied: 0,
            painSuppressionExpired: false,
            recoveredConditions: [],
            regenerationPenalty,
        };
    }

    const healingBonusApplied = row.pending_healing_bonus;
    const { results } = rollRegeneration(row, {
        lepModifier: healingBonusApplied + regenerationPenalty,
        aspModifier: regenerationPenalty,
        kapModifier: regenerationPenalty,
    });
    const update: Record<string, number> = {};
    for (const r of results) {
        if (r.newValue === r.oldValue) continue;
        if (r.type === 'lep') update.le_current = r.newValue;
        else if (r.type === 'asp') update.asp_current = r.newValue;
        else if (r.type === 'kap') update.kap_current = r.newValue;
    }
    const woundsHealed = calculateNaturalWoundHealing(row.wounds);
    const woundsAfter = Math.max(0, row.wounds - woundsHealed);
    const nextPainPhases = Math.max(0, row.pain_suppression_phases - 1);
    const painSuppressionExpired = row.pain_suppression > 0 && nextPainPhases === 0;
    update.wounds = woundsAfter;
    update.pending_healing_bonus = 0;
    update.pain_suppression_phases = nextPainPhases;
    update.pain_suppression = nextPainPhases > 0 ? row.pain_suppression : 0;
    update.pain_modifier = 0;

    let recoveredConditions: string[] = [];
    await db.transaction(async tx => {
        await tx.update(stats).set(update).where(eq(stats.id, row.id));
        recoveredConditions = await recoverRestConditionsForPlayer(tx, player.id);
        const activeSessions = await tx
            .select({ id: combatSessions.id })
            .from(combatSessions)
            .where(inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED']));
        if (activeSessions.length > 0) {
            const lepResult = results.find(r => r.type === 'lep');
            await tx
                .update(combatants)
                .set({ current_hp: lepResult?.newValue ?? row.le_current, wounds: woundsAfter })
                .where(
                    and(
                        eq(combatants.player_id, player.id),
                        inArray(
                            combatants.session_id,
                            activeSessions.map(session => session.id)
                        )
                    )
                );
        }
    });
    return {
        characterName: player.name,
        alreadyFull: false,
        results,
        woundsBefore: row.wounds,
        woundsHealed,
        woundsAfter,
        healingBonusApplied,
        painSuppressionExpired,
        recoveredConditions,
        regenerationPenalty,
    };
}
