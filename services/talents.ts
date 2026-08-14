/**
 * Talent services — the 3d20 Talentprobe resolution + talent/skill management.
 * ctx-authenticated (Discord command or website JWT); throws HttpError on
 * business failures. No discord.js, no HTTP.
 *
 * The probe math is split into a pure evaluator (`evaluateProbe`/`calculateQS`)
 * so it is deterministic and unit-testable; `resolveProbe` is the orchestrator
 * that loads the caller's sheet + learned talent, rolls, and returns structured
 * state. Clients (Discord embed, website JSON) render that state themselves.
 */
import { db } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { combatants, combatSessions, talents, playerTalents } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { getCharacterSheet } from './characters';
import { rollDice } from '../utils/rollUtil';
import { calculateWoundPenalty } from '../utils/woundUtils';
import type { Ctx } from './_ctx';
import { getCombatantModifiers } from './combatEffects';

const VALID_ATTRS = new Set(['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk']);

// ---------------------------------------------------------------------------
// Pure probe math (no ctx, no DB, no randomness from this layer)
// ---------------------------------------------------------------------------

/** Map remaining FtW after compensation → DSA 5 quality level (1-6). */
export function calculateQS(remainingFtw: number): number {
    if (remainingFtw >= 16) return 6;
    if (remainingFtw >= 13) return 5;
    if (remainingFtw >= 10) return 4;
    if (remainingFtw >= 7) return 3;
    if (remainingFtw >= 4) return 2;
    return 1;
}

export interface ProbeCheckResult {
    roll: number;
    attrCode: string; // uppercase stat code as stored on the talent (e.g. 'MU')
    attrValue: number;
    /** Points of FtW spent to absorb this die's overshoot (0 if the die passed). */
    needed: number;
}

export interface EvaluateProbeInput {
    attrCodes: [string, string, string];
    attrValues: [number, number, number];
    baseFtw: number;
    modifier: number;
    rolls: [number, number, number];
}

export interface EvaluateProbeResult {
    effectiveFtw: number;
    remainingFtw: number;
    success: boolean;
    qs: number; // 1-6 on success, 0 on failure
    checkResults: ProbeCheckResult[];
}

/**
 * Pure 3d20 talent-probe evaluation. For each die, any amount rolled above the
 * attribute is paid out of the effective FtW pool; success iff the pool stays
 * non-negative. QS derives from what's left.
 */
export function evaluateProbe(input: EvaluateProbeInput): EvaluateProbeResult {
    const effectiveFtw = input.baseFtw + input.modifier;
    let remainingFtw = effectiveFtw;
    const checkResults: ProbeCheckResult[] = input.rolls.map((roll, i) => {
        const attrValue = input.attrValues[i];
        const overshoot = roll - attrValue;
        const needed = overshoot > 0 ? overshoot : 0;
        remainingFtw -= needed;
        return { roll, attrCode: input.attrCodes[i], attrValue, needed };
    });
    const success = remainingFtw >= 0;
    const qs = success ? calculateQS(remainingFtw) : 0;
    return { effectiveFtw, remainingFtw, success, qs, checkResults };
}

// ---------------------------------------------------------------------------
// Orchestrated service functions (ctx-authenticated, hit the DB)
// ---------------------------------------------------------------------------

export interface ProbeResult extends EvaluateProbeResult {
    characterName: string;
    talent: { id: number; name: string; stat1: string; stat2: string; stat3: string };
    baseFtw: number;
    modifier: number;
    woundPenalty: number;
    conditionModifier: number;
    rolls: [number, number, number];
}

export interface ResolveProbeInput {
    talentId: number;
    modifier?: number;
}

/**
 * Resolve a Talentprobe for the caller's selected character against one of their
 * learned talents. Throws 404 if no character is selected or the talent isn't
 * learned. Returns full structured state; clients render it.
 *
 * Note: createPlayer seeds a player_talents row for EVERY catalog talent at
 * FtW 0, so every catalog talent is probe-able (FtW 0 = untrained, usually a
 * failure). The 404 here only fires for a talent id with no player_talents row
 * for this character — e.g. a bogus id, or a talent added to the catalog after
 * the character was created.
 */
export async function resolveProbe(ctx: Ctx, input: ResolveProbeInput): Promise<ProbeResult> {
    const modifier = input.modifier ?? 0;
    const { player, stats } = await getCharacterSheet(ctx); // 404 if no selected character
    if (!stats) throw httpError(400, 'Character has no stats set');

    const [learned] = await db
        .select({
            ftw: playerTalents.ftw,
            talent_id: talents.id,
            talent_name: talents.name,
            talent_stat1: talents.stat1,
            talent_stat2: talents.stat2,
            talent_stat3: talents.stat3,
            affected_by_encumbrance: talents.affected_by_encumbrance,
        })
        .from(playerTalents)
        .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
        .where(and(eq(playerTalents.player_id, player.id), eq(playerTalents.talent_id, input.talentId)))
        .limit(1);
    if (!learned || learned.talent_id == null) {
        throw httpError(404, 'Talent not found or not learned');
    }

    const attrCodes: [string, string, string] = [learned.talent_stat1, learned.talent_stat2, learned.talent_stat3];
    const woundPenalty = calculateWoundPenalty(stats.wounds);
    const [activeCombatant] = await db
        .select({ combatant: combatants })
        .from(combatants)
        .innerJoin(combatSessions, eq(combatants.session_id, combatSessions.id))
        .where(and(eq(combatants.player_id, player.id), inArray(combatSessions.state, ['RUNNING', 'PAUSED'])))
        .limit(1);
    const combatModifierState = activeCombatant ? await getCombatantModifiers(activeCombatant.combatant) : null;
    const conditionModifier = combatModifierState
        ? learned.affected_by_encumbrance
            ? combatModifierState.modifiers.checkModifier
            : combatModifierState.unencumberedCheckModifier
        : learned.affected_by_encumbrance
          ? -stats.belastung
          : 0;
    // Legacy rule preserved from commands/probe.js: an unset (0) attribute counts
    // as the average (8) for the probe. Unknown stat codes also fall back to 8.
    const attrValues = attrCodes.map(code => {
        const key = code.toLowerCase();
        const raw = VALID_ATTRS.has(key) ? (stats as Record<string, number>)[key] : 0;
        return Math.max(0, (raw || 8) - woundPenalty + conditionModifier);
    }) as [number, number, number];

    const rolls: [number, number, number] = [rollDice(20), rollDice(20), rollDice(20)];
    const evalResult = evaluateProbe({ attrCodes, attrValues, baseFtw: learned.ftw, modifier, rolls });

    return {
        characterName: player.name,
        talent: {
            id: learned.talent_id,
            name: learned.talent_name,
            stat1: learned.talent_stat1,
            stat2: learned.talent_stat2,
            stat3: learned.talent_stat3,
        },
        baseFtw: learned.ftw,
        modifier,
        woundPenalty,
        conditionModifier,
        rolls,
        ...evalResult,
    };
}

/** The full talent catalog (reference data; ctx kept for signature uniformity). */
export async function listTalents(_ctx: Ctx) {
    return db.select().from(talents).orderBy(talents.name);
}

/** Explicit owner/tabletop override for importing or correcting a paper-sheet talent value. */
export async function assignSkill(ctx: Ctx, input: { talentId: number; ftw: number }) {
    if (!Number.isInteger(input.talentId) || input.talentId <= 0) {
        throw httpError(400, 'talentId must be a positive integer');
    }
    if (!Number.isInteger(input.ftw) || input.ftw < 0) {
        throw httpError(400, 'ftw must be a non-negative integer');
    }
    const { player } = await getCharacterSheet(ctx); // ensures ownership + selected

    const [talent] = await db.select({ id: talents.id }).from(talents).where(eq(talents.id, input.talentId)).limit(1);
    if (!talent) throw httpError(404, 'Talent not found');

    // Keep the explicit lookup so this works both before and after migration 0008's unique constraint.
    const [existing] = await db
        .select({ id: playerTalents.id })
        .from(playerTalents)
        .where(and(eq(playerTalents.player_id, player.id), eq(playerTalents.talent_id, input.talentId)))
        .limit(1);
    if (existing) {
        const [updated] = await db
            .update(playerTalents)
            .set({ ftw: input.ftw })
            .where(eq(playerTalents.id, existing.id))
            .returning();
        return updated;
    }
    const [created] = await db
        .insert(playerTalents)
        .values({ player_id: player.id, talent_id: input.talentId, ftw: input.ftw })
        .returning();
    return created;
}

/** The caller's learned talents (skills) with their probe attributes. */
export async function listSkills(ctx: Ctx) {
    const { player } = await getCharacterSheet(ctx);
    return db
        .select({
            id: playerTalents.id,
            player_id: playerTalents.player_id,
            talent_id: talents.id,
            talent_name: talents.name,
            stat1: talents.stat1,
            stat2: talents.stat2,
            stat3: talents.stat3,
            category: talents.category,
            advancement_factor: talents.advancement_factor,
            affected_by_encumbrance: talents.affected_by_encumbrance,
            ftw: playerTalents.ftw,
        })
        .from(playerTalents)
        .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
        .where(eq(playerTalents.player_id, player.id));
}
