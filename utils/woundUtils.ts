/**
 * Core calculations for the optional DSA 5e wound-threshold focus rule.
 *
 * Wounds are tracked independently from life points. Hit-zone-specific effects
 * remain a later roadmap concern; this module tracks the aggregate wound count
 * produced by a single damage event.
 */

export const MAX_WOUNDS_PER_HIT = 3;
export const WOUND_INCAPACITATION_LIMIT = 3;

/** KO / 2, rounded down, plus advantages/disadvantages such as Eisern/Gläsern. */
export function calculateWoundThreshold(ko: number, modifier = 0): number {
    if (!Number.isFinite(ko) || ko <= 0) return 0;

    const base = Math.floor(ko / 2);
    const adjusted = base + (Number.isFinite(modifier) ? Math.trunc(modifier) : 0);
    return Math.max(1, adjusted);
}

/**
 * One wound is caused for each full threshold reached by a damage event, capped
 * at three because the focus rule defines effects for 1x, 2x, and 3x threshold.
 */
export function calculateWoundsInflicted(damage: number, woundThreshold: number | null | undefined): number {
    if (!Number.isFinite(damage) || damage <= 0) return 0;
    if (!Number.isFinite(woundThreshold) || !woundThreshold || woundThreshold <= 0) return 0;

    return Math.min(MAX_WOUNDS_PER_HIT, Math.floor(damage / woundThreshold));
}

/** The committed roadmap penalty is -1 to checks per accumulated wound. */
export function calculateWoundPenalty(wounds: number): number {
    if (!Number.isFinite(wounds)) return 0;
    return Math.min(WOUND_INCAPACITATION_LIMIT, Math.max(0, Math.trunc(wounds)));
}

/** Three aggregate wounds make the character unable to act until one heals. */
export function isIncapacitatedByWounds(wounds: number): boolean {
    return calculateWoundPenalty(wounds) >= WOUND_INCAPACITATION_LIMIT;
}

/**
 * DSANewBot's aggregate-wound recovery rule: a completed regeneration phase
 * removes one wound. The official focus rule describes wound effects rather
 * than a durable aggregate counter, so this bridge rule is documented in
 * docs/wound-system-rules.md.
 */
export function calculateNaturalWoundHealing(wounds: number): number {
    const currentWounds = Number.isFinite(wounds) ? Math.max(0, Math.trunc(wounds)) : 0;
    return currentWounds > 0 ? 1 : 0;
}

/** Pending LeP added to the next regeneration phase after Heilung fördern. */
export function calculatePromotedHealing(qualityLevel: number, baseFtw: number, criticalSuccess = false): number {
    if (criticalSuccess) {
        return Number.isFinite(baseFtw) ? Math.max(0, Math.trunc(baseFtw)) : 0;
    }
    if (!Number.isFinite(qualityLevel) || qualityLevel < 1) return 0;
    const qs = Math.min(6, Math.trunc(qualityLevel));
    return qs >= 4 ? qs + 1 : qs;
}

/** Heilkunde Wunden reduces bleeding by floor(QS / 2) rounds. */
export function calculateBleedingReduction(qualityLevel: number): number {
    if (!Number.isFinite(qualityLevel) || qualityLevel < 1) return 0;
    return Math.floor(Math.min(6, Math.trunc(qualityLevel)) / 2);
}

/** Effective Schmerz after temporary treatment and treatment mishaps. */
export function calculateEffectivePainLevel(basePain: number, suppression = 0, modifier = 0): number {
    const normalizedBase = Number.isFinite(basePain) ? Math.trunc(basePain) : 0;
    const normalizedSuppression = Number.isFinite(suppression) ? Math.max(0, Math.trunc(suppression)) : 0;
    const normalizedModifier = Number.isFinite(modifier) ? Math.trunc(modifier) : 0;
    return Math.min(4, Math.max(0, normalizedBase + normalizedModifier - normalizedSuppression));
}

export interface WoundDamageResult {
    previousWounds: number;
    woundsInflicted: number;
    totalWounds: number;
    woundThreshold: number;
}

/** Apply a single damage event to an aggregate wound counter. */
export function applyWoundDamage(
    currentWounds: number,
    damage: number,
    woundThreshold: number | null | undefined
): WoundDamageResult {
    const previousWounds = Number.isFinite(currentWounds) ? Math.max(0, Math.trunc(currentWounds)) : 0;
    const normalizedThreshold =
        Number.isFinite(woundThreshold) && woundThreshold && woundThreshold > 0 ? Math.trunc(woundThreshold) : 0;
    const woundsInflicted = calculateWoundsInflicted(damage, normalizedThreshold);

    return {
        previousWounds,
        woundsInflicted,
        totalWounds: previousWounds + woundsInflicted,
        woundThreshold: normalizedThreshold,
    };
}
