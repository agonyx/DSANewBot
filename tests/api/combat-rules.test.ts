import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTION_REASON,
    DEFENSE_REASON,
    MANEUVER_REASON,
    evaluateActionAvailability,
    evaluateDefenseOptions,
    evaluateManeuverEligibility,
    getRangedBandModifiers,
} from '../../utils/combatRules';

const base = {
    attackKind: 'MELEE' as const,
    attackOutcome: 'NORMAL_HIT' as const,
    defenseCount: 0,
    parryValue: 12,
    dodgeValue: 8,
    hasParryWeapon: true,
    hasShield: false,
    targetAlive: true,
};

describe('pure defense rule evaluation', () => {
    it('offers melee parry, dodge, and decline with stable values', () => {
        const options = evaluateDefenseOptions(base);
        assert.deepEqual(
            options.map(option => [option.choice, option.available, option.effectiveValue, option.reasonCode]),
            [
                ['PARRY', true, 12, DEFENSE_REASON.AVAILABLE],
                ['DODGE', true, 8, DEFENSE_REASON.AVAILABLE],
                ['DECLINE', true, null, DEFENSE_REASON.AVAILABLE],
            ]
        );
    });

    it('shares the multiple-defense penalty between parry and dodge', () => {
        const options = evaluateDefenseOptions({ ...base, defenseCount: 2, penaltyStep: 3 });
        assert.equal(options[0].effectiveValue, 6);
        assert.equal(options[1].effectiveValue, 2);
        assert.equal(options[0].modifiers.multipleDefense, -6);
    });

    it('permits only shield parries at range and applies shooting modifiers', () => {
        const withoutShield = evaluateDefenseOptions({ ...base, attackKind: 'RANGED_SHOT' });
        assert.equal(withoutShield[0].reasonCode, DEFENSE_REASON.RANGED_REQUIRES_SHIELD);
        assert.equal(withoutShield[1].effectiveValue, 4);
        const withShield = evaluateDefenseOptions({ ...base, attackKind: 'RANGED_SHOT', hasShield: true });
        assert.equal(withShield[0].effectiveValue, 8);
    });

    it('removes defenses for criticals, opportunity attacks, and prohibited states', () => {
        assert.ok(
            evaluateDefenseOptions({ ...base, attackOutcome: 'CRITICAL_SUCCESS' })
                .slice(0, 2)
                .every(option => option.reasonCode === DEFENSE_REASON.CRITICAL_UNOPPOSED)
        );
        assert.ok(
            evaluateDefenseOptions({ ...base, attackKind: 'OPPORTUNITY' })
                .slice(0, 2)
                .every(option => option.reasonCode === DEFENSE_REASON.OPPORTUNITY_UNOPPOSED)
        );
        assert.ok(
            evaluateDefenseOptions({ ...base, defenseProhibited: true })
                .slice(0, 2)
                .every(option => option.reasonCode === DEFENSE_REASON.DEFENSE_PROHIBITED)
        );
    });

    it('marks a chosen defense as interrupting a longer action', () => {
        const [parry, dodge, decline] = evaluateDefenseOptions({ ...base, ongoingLongAction: true });
        assert.equal(parry.interruptsLongAction, true);
        assert.equal(dodge.interruptsLongAction, true);
        assert.equal(decline.interruptsLongAction, false);
    });

    it('requires a shield against large attackers and permits only dodge against huge attackers', () => {
        const large = evaluateDefenseOptions({ ...base, attackerSize: 'large' });
        assert.equal(large[0].reasonCode, DEFENSE_REASON.SIZE_PROHIBITS_PARRY);
        assert.equal(large[1].available, true);
        const largeWithShield = evaluateDefenseOptions({ ...base, attackerSize: 'large', hasShield: true });
        assert.equal(largeWithShield[0].available, true);
        const huge = evaluateDefenseOptions({ ...base, attackerSize: 'huge', hasShield: true });
        assert.equal(huge[0].reasonCode, DEFENSE_REASON.SIZE_PROHIBITS_PARRY);
        assert.equal(huge[1].available, true);
    });
});

describe('pure action and ranged-band rules', () => {
    it('hides state-specific actions with stable reason codes', () => {
        const choices = evaluateActionAvailability({ activeTurn: true, incapacitated: false });
        assert.equal(choices.attack.available, true);
        assert.equal(choices.reload.reasonCode, ACTION_REASON.NOT_RELOADING);
        assert.equal(choices.retrieveItem.reasonCode, ACTION_REASON.NO_DROPPED_ITEM);
        assert.equal(choices.fullDefense.available, true);

        const missingCapabilities = evaluateActionAvailability({
            activeTurn: true,
            incapacitated: false,
            hasCompatibleManeuver: false,
            canUseTwoWeapons: false,
            hasOpportunity: false,
            canUseFullDefense: false,
            hasLearnedSupernatural: false,
        });
        assert.equal(missingCapabilities.maneuver.reasonCode, ACTION_REASON.NO_COMPATIBLE_MANEUVER);
        assert.equal(missingCapabilities.twoWeapon.reasonCode, ACTION_REASON.TWO_WEAPON_UNAVAILABLE);
        assert.equal(missingCapabilities.opportunity.reasonCode, ACTION_REASON.NO_OPPORTUNITY);
        assert.equal(missingCapabilities.fullDefense.reasonCode, ACTION_REASON.FULL_DEFENSE_UNLEARNED);
        assert.equal(missingCapabilities.spellOrLiturgy.reasonCode, ACTION_REASON.NO_LEARNED_SUPERNATURAL);

        const afterFreeAction = evaluateActionAvailability({
            activeTurn: true,
            incapacitated: false,
            freeActionSpent: true,
            turnOpening: false,
        });
        assert.equal(afterFreeAction.fullDefense.available, false);
        assert.equal(afterFreeAction.fullDefense.reasonCode, ACTION_REASON.ROUND_OPENING_PASSED);
    });

    it('uses the official close, medium, and far modifiers', () => {
        assert.deepEqual(getRangedBandModifiers('close'), { attack: 2, damage: 1, authority: 'CORE' });
        assert.deepEqual(getRangedBandModifiers('medium'), { attack: 0, damage: 0, authority: 'CORE' });
        assert.deepEqual(getRangedBandModifiers('far'), { attack: -2, damage: -1, authority: 'CORE' });
    });
});

describe('pure maneuver eligibility', () => {
    const maneuverBase = {
        learned: true,
        weaponType: 'MELEE' as const,
        maneuverActionType: 'MELEE',
        maneuverType: 'disarm',
        prerequisites: { ge: 12, techniques: ['Schwerter'], requires: 'Finte I' },
        attributes: { mu: 12, in: 12, ge: 14, ff: 10, kk: 13 },
        combatValue: 14,
        handsFree: 1,
        combatTechnique: 'Schwerter',
        learnedAbilityNames: ['Finte I'],
    };

    it('accepts learned maneuvers compatible with the equipped technique', () => {
        assert.deepEqual(evaluateManeuverEligibility(maneuverBase), {
            available: true,
            reasonCode: MANEUVER_REASON.AVAILABLE,
            detail: null,
        });
    });

    it('rejects passive, wrong-weapon, prerequisite, and unlearned choices with stable codes', () => {
        assert.equal(
            evaluateManeuverEligibility({ ...maneuverBase, learned: false }).reasonCode,
            MANEUVER_REASON.NOT_LEARNED
        );
        assert.equal(
            evaluateManeuverEligibility({ ...maneuverBase, maneuverType: 'full_defense' }).reasonCode,
            MANEUVER_REASON.PASSIVE_OR_DEDICATED_ACTION
        );
        assert.equal(
            evaluateManeuverEligibility({ ...maneuverBase, weaponType: 'RANGED' }).reasonCode,
            MANEUVER_REASON.WEAPON_TYPE_MISMATCH
        );
        assert.equal(
            evaluateManeuverEligibility({ ...maneuverBase, attributes: { ...maneuverBase.attributes, ge: 8 } })
                .reasonCode,
            MANEUVER_REASON.ATTRIBUTE_PREREQUISITE
        );
        assert.equal(
            evaluateManeuverEligibility({ ...maneuverBase, learnedAbilityNames: [] }).reasonCode,
            MANEUVER_REASON.ABILITY_PREREQUISITE
        );
    });
});
