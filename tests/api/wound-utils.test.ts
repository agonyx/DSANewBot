import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_WOUNDS_PER_HIT,
    WOUND_INCAPACITATION_LIMIT,
    applyWoundDamage,
    calculateBleedingReduction,
    calculateEffectivePainLevel,
    calculateNaturalWoundHealing,
    calculatePromotedHealing,
    calculateWoundPenalty,
    calculateWoundsInflicted,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} from '../../utils/woundUtils';

describe('wound threshold calculations', () => {
    it('uses half KO rounded down', () => {
        assert.equal(calculateWoundThreshold(14), 7);
        assert.equal(calculateWoundThreshold(13), 6);
    });

    it('applies Eisern/Gläsern-style modifiers and keeps positive thresholds usable', () => {
        assert.equal(calculateWoundThreshold(14, 1), 8);
        assert.equal(calculateWoundThreshold(14, -1), 6);
        assert.equal(calculateWoundThreshold(1, -1), 1);
        assert.equal(calculateWoundThreshold(0), 0);
    });
});

describe('aggregate wound tracking', () => {
    it('inflicts wounds only when damage reaches the threshold', () => {
        assert.equal(calculateWoundsInflicted(6, 7), 0);
        assert.equal(calculateWoundsInflicted(7, 7), 1);
        assert.equal(calculateWoundsInflicted(14, 7), 2);
        assert.equal(calculateWoundsInflicted(21, 7), 3);
    });

    it('caps a single hit at the highest defined threshold multiple', () => {
        assert.equal(calculateWoundsInflicted(100, 5), MAX_WOUNDS_PER_HIT);
    });

    it('keeps wounds independent from life points and accumulates them', () => {
        assert.deepEqual(applyWoundDamage(2, 14, 7), {
            previousWounds: 2,
            woundsInflicted: 2,
            totalWounds: 4,
            woundThreshold: 7,
        });
    });

    it('does not create wounds without a usable threshold', () => {
        assert.equal(calculateWoundsInflicted(20, 0), 0);
        assert.equal(calculateWoundsInflicted(20, null), 0);
    });

    it('applies the committed wound penalty and incapacitates at three wounds', () => {
        assert.equal(WOUND_INCAPACITATION_LIMIT, 3);
        assert.equal(calculateWoundPenalty(2), 2);
        assert.equal(calculateWoundPenalty(99), 3);
        assert.equal(isIncapacitatedByWounds(2), false);
        assert.equal(isIncapacitatedByWounds(3), true);
    });
});

describe('wound recovery and treatment', () => {
    it('naturally heals one wound per completed regeneration phase', () => {
        assert.equal(calculateNaturalWoundHealing(2), 1);
        assert.equal(calculateNaturalWoundHealing(0), 0);
    });

    it('calculates promoted healing from QS or a critical success', () => {
        assert.equal(calculatePromotedHealing(3, 8), 3);
        assert.equal(calculatePromotedHealing(4, 8), 5);
        assert.equal(calculatePromotedHealing(6, 8), 7);
        assert.equal(calculatePromotedHealing(2, 8, true), 8);
    });

    it('reduces bleeding by half QS rounded down', () => {
        assert.equal(calculateBleedingReduction(1), 0);
        assert.equal(calculateBleedingReduction(2), 1);
        assert.equal(calculateBleedingReduction(6), 3);
    });

    it('clamps treated pain to the supported 0-4 range', () => {
        assert.equal(calculateEffectivePainLevel(3, 2), 1);
        assert.equal(calculateEffectivePainLevel(3, 0, 1), 4);
        assert.equal(calculateEffectivePainLevel(1, 4), 0);
    });
});
