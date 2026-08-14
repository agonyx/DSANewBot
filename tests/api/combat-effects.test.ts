import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateCombatModifiers,
    getCalledShotPenalty,
    getMultipleDefensePenalty,
    getRangePenalty,
    getStatusDamage,
    getTwoWeaponPenalties,
    nextDuration,
    progressStatusEffectData,
    resolveHumanoidHitZone,
    validateStatusEffectData,
} from '../../utils/combatEffectUtils';

describe('combat effect modifiers', () => {
    it('caps condition and pain penalties and applies status restrictions', () => {
        const result = calculateCombatModifiers(
            [{ condition_type: 'furcht', level: 3 }],
            [{ status_type: 'liegend' }, { status_type: 'ueberrascht' }],
            [{ at_modifier: 2, pa_modifier: 1 }],
            3
        );
        assert.equal(result.checkPenalty, 5);
        assert.equal(result.atModifier, -7);
        assert.equal(result.paModifier, -6);
        assert.equal(result.prohibitsActions, false);
        assert.equal(result.prohibitsDefense, true);
    });

    it('makes Pain IV, level-IV conditions, and direct statuses incapacitating', () => {
        assert.equal(calculateCombatModifiers([], [], [], 4).prohibitsActions, true);
        assert.equal(
            calculateCombatModifiers([{ condition_type: 'paralyse', level: 4 }], [], [], 0).prohibitsDefense,
            true
        );
        assert.equal(calculateCombatModifiers([], [{ status_type: 'bewusstlos' }], [], 0).prohibitsActions, true);
        assert.equal(
            calculateCombatModifiers(
                [
                    { condition_type: 'furcht', level: 3 },
                    { condition_type: 'betaeubung', level: 3 },
                    { condition_type: 'verwirrung', level: 2 },
                ],
                [],
                [],
                0
            ).prohibitsActions,
            true
        );
    });

    it('validates typed DOT and penalty payloads', () => {
        assert.deepEqual(validateStatusEffectData({ damagePerRound: 2, checkPenalty: 1 }), {
            damagePerRound: 2,
            checkPenalty: 1,
        });
        assert.throws(() => validateStatusEffectData({ sql: 'nope' }), /Unsupported/);
        assert.equal(getStatusDamage({ status_type: 'blutend' }), 1);
        assert.equal(getStatusDamage({ status_type: 'vergiftet', effect_data: { damagePerRound: 3 } }), 3);
        assert.deepEqual(
            progressStatusEffectData({
                status_type: 'krank',
                effect_data: { damagePerRound: 1, damageProgressionPerRound: 2, maxDamagePerRound: 4 },
            }),
            { damagePerRound: 3, damageProgressionPerRound: 2, maxDamagePerRound: 4 }
        );
    });
});

describe('combat round and attack context rules', () => {
    it('tracks cumulative defenses with a configurable step', () => {
        assert.equal(getMultipleDefensePenalty(0), 0);
        assert.equal(getMultipleDefensePenalty(1), 3);
        assert.equal(getMultipleDefensePenalty(2, 2), 4);
    });

    it('ticks finite durations and preserves permanent effects', () => {
        assert.deepEqual(nextDuration(2), { remaining: 1, expired: false });
        assert.deepEqual(nextDuration(1), { remaining: 0, expired: true });
        assert.deepEqual(nextDuration(null), { remaining: null, expired: false });
    });

    it('uses documented called-shot, range, and humanoid hit-zone tables', () => {
        assert.equal(getCalledShotPenalty('head'), -10);
        assert.equal(getCalledShotPenalty('torso'), -4);
        assert.equal(getCalledShotPenalty('left_leg'), -8);
        assert.equal(getRangePenalty('close'), 0);
        assert.equal(getRangePenalty('medium'), -2);
        assert.equal(getRangePenalty('far'), -4);
        assert.equal(resolveHumanoidHitZone(2, 'medium'), 'head');
        assert.equal(resolveHumanoidHitZone(3, 'medium'), 'torso');
        assert.equal(resolveHumanoidHitZone(13, 'medium'), 'left_arm');
        assert.equal(resolveHumanoidHitZone(18, 'medium'), 'right_leg');
    });

    it('applies two-weapon training and the untrained off-hand penalty', () => {
        assert.deepEqual(getTwoWeaponPenalties(), { mainHand: -2, offHand: -6 });
        assert.deepEqual(getTwoWeaponPenalties([-1]), { mainHand: -1, offHand: -5 });
        assert.deepEqual(getTwoWeaponPenalties([-1, 0]), { mainHand: 0, offHand: -4 });
    });
});
