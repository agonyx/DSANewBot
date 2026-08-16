/**
 * Pure DSA 5 combat rule evaluation.
 *
 * This module deliberately contains no Discord or database code.  Every
 * rejected option has a stable reason code so the HTTP API and interaction UI
 * can explain the same decision without duplicating rule logic.
 */

export const ACTION_KINDS = ['ACTION', 'FREE_ACTION', 'DEFENSE', 'SYSTEM_REACTION'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ATTACK_KINDS = ['MELEE', 'RANGED_SHOT', 'RANGED_THROWN', 'OPPORTUNITY'] as const;
export type AttackKind = (typeof ATTACK_KINDS)[number];

export const DEFENSE_CHOICES = ['PARRY', 'DODGE', 'DECLINE'] as const;
export type DefenseChoice = (typeof DEFENSE_CHOICES)[number];

export type RuleAuthority = 'CORE' | 'OPTIONAL_FOCUS' | 'HOUSE_RULE' | 'OPEN_DECISION';

export const DEFENSE_REASON = {
    AVAILABLE: 'AVAILABLE',
    ATTACK_MISSED: 'ATTACK_MISSED',
    CRITICAL_UNOPPOSED: 'CRITICAL_UNOPPOSED',
    OPPORTUNITY_UNOPPOSED: 'OPPORTUNITY_UNOPPOSED',
    TARGET_DEFEATED: 'TARGET_DEFEATED',
    DEFENSE_PROHIBITED: 'DEFENSE_PROHIBITED',
    MANEUVER_PROHIBITS_DEFENSE: 'MANEUVER_PROHIBITS_DEFENSE',
    SIZE_PROHIBITS_PARRY: 'SIZE_PROHIBITS_PARRY',
    NO_PARRY_VALUE: 'NO_PARRY_VALUE',
    NO_DODGE_VALUE: 'NO_DODGE_VALUE',
    RANGED_REQUIRES_SHIELD: 'RANGED_REQUIRES_SHIELD',
    NPC_DEFENSE_LIMIT: 'NPC_DEFENSE_LIMIT',
} as const;

export type DefenseReasonCode = (typeof DEFENSE_REASON)[keyof typeof DEFENSE_REASON];

export interface DefenseOption {
    choice: DefenseChoice;
    available: boolean;
    reasonCode: DefenseReasonCode;
    effectiveValue: number | null;
    modifiers: {
        multipleDefense: number;
        rangedDefense: number;
        situational: number;
    };
    interruptsLongAction: boolean;
    authority: RuleAuthority;
}

export interface DefenseEvaluationInput {
    attackKind: AttackKind;
    attackOutcome: 'CRITICAL_SUCCESS' | 'NORMAL_HIT' | 'NORMAL_MISS' | 'BOTCH';
    defenseCount: number;
    penaltyStep?: number;
    parryValue: number;
    dodgeValue: number;
    hasParryWeapon: boolean;
    hasShield: boolean;
    targetAlive: boolean;
    defenseProhibited?: boolean;
    maneuverProhibitsDefense?: boolean;
    sizeProhibitsParry?: boolean;
    attackerSize?: 'tiny' | 'small' | 'medium' | 'large' | 'huge';
    situationalParryModifier?: number;
    situationalDodgeModifier?: number;
    ongoingLongAction?: boolean;
    npcDefenseLimit?: number | null;
}

function integer(value: number | undefined, fallback = 0): number {
    return Number.isFinite(value) ? Math.trunc(value!) : fallback;
}

function firstGlobalReason(input: DefenseEvaluationInput): DefenseReasonCode | null {
    if (!input.targetAlive) return DEFENSE_REASON.TARGET_DEFEATED;
    if (input.attackOutcome !== 'NORMAL_HIT') {
        return input.attackOutcome === 'CRITICAL_SUCCESS'
            ? DEFENSE_REASON.CRITICAL_UNOPPOSED
            : DEFENSE_REASON.ATTACK_MISSED;
    }
    if (input.attackKind === 'OPPORTUNITY') return DEFENSE_REASON.OPPORTUNITY_UNOPPOSED;
    if (input.defenseProhibited) return DEFENSE_REASON.DEFENSE_PROHIBITED;
    if (input.maneuverProhibitsDefense) return DEFENSE_REASON.MANEUVER_PROHIBITS_DEFENSE;
    if (input.npcDefenseLimit !== null && input.npcDefenseLimit !== undefined) {
        if (Math.max(0, integer(input.defenseCount)) >= Math.max(0, integer(input.npcDefenseLimit))) {
            return DEFENSE_REASON.NPC_DEFENSE_LIMIT;
        }
    }
    return null;
}

/** Evaluate every defender choice for one successful attack. */
export function evaluateDefenseOptions(input: DefenseEvaluationInput): DefenseOption[] {
    const defenseCount = Math.max(0, integer(input.defenseCount));
    const penaltyStep = Math.max(0, integer(input.penaltyStep, 3));
    const multipleDefense = -(defenseCount * penaltyStep);
    const rangedDefense = input.attackKind === 'RANGED_SHOT' ? -4 : input.attackKind === 'RANGED_THROWN' ? -2 : 0;
    const globalReason = firstGlobalReason(input);
    const base = {
        modifiers: { multipleDefense, rangedDefense, situational: 0 },
        interruptsLongAction: Boolean(input.ongoingLongAction),
        authority: 'CORE' as const,
    };

    let parryReason = globalReason;
    if (!parryReason && input.attackKind.startsWith('RANGED') && !input.hasShield) {
        parryReason = DEFENSE_REASON.RANGED_REQUIRES_SHIELD;
    }
    if (!parryReason && input.attackKind === 'MELEE' && !input.hasParryWeapon) {
        parryReason = DEFENSE_REASON.NO_PARRY_VALUE;
    }
    if (
        !parryReason &&
        (input.sizeProhibitsParry ||
            input.attackerSize === 'huge' ||
            (input.attackerSize === 'large' && !input.hasShield))
    ) {
        parryReason = DEFENSE_REASON.SIZE_PROHIBITS_PARRY;
    }
    if (!parryReason && integer(input.parryValue) <= 0) parryReason = DEFENSE_REASON.NO_PARRY_VALUE;
    const parrySituational = integer(input.situationalParryModifier);

    let dodgeReason = globalReason;
    if (!dodgeReason && integer(input.dodgeValue) <= 0) dodgeReason = DEFENSE_REASON.NO_DODGE_VALUE;
    const dodgeSituational = integer(input.situationalDodgeModifier);

    return [
        {
            choice: 'PARRY',
            available: !parryReason,
            reasonCode: parryReason ?? DEFENSE_REASON.AVAILABLE,
            effectiveValue: parryReason
                ? null
                : Math.max(0, integer(input.parryValue) + multipleDefense + rangedDefense + parrySituational),
            ...base,
            modifiers: { multipleDefense, rangedDefense, situational: parrySituational },
        },
        {
            choice: 'DODGE',
            available: !dodgeReason,
            reasonCode: dodgeReason ?? DEFENSE_REASON.AVAILABLE,
            effectiveValue: dodgeReason
                ? null
                : Math.max(0, integer(input.dodgeValue) + multipleDefense + rangedDefense + dodgeSituational),
            ...base,
            modifiers: { multipleDefense, rangedDefense, situational: dodgeSituational },
        },
        {
            choice: 'DECLINE',
            available: input.attackOutcome === 'NORMAL_HIT' && input.targetAlive,
            reasonCode:
                input.attackOutcome === 'NORMAL_HIT' && input.targetAlive
                    ? DEFENSE_REASON.AVAILABLE
                    : (globalReason ?? DEFENSE_REASON.ATTACK_MISSED),
            effectiveValue: null,
            modifiers: { multipleDefense: 0, rangedDefense: 0, situational: 0 },
            interruptsLongAction: false,
            authority: 'CORE',
        },
    ];
}

export const ACTION_REASON = {
    AVAILABLE: 'AVAILABLE',
    NOT_ACTIVE_TURN: 'NOT_ACTIVE_TURN',
    INCAPACITATED: 'INCAPACITATED',
    ACTION_ALREADY_SPENT: 'ACTION_ALREADY_SPENT',
    ROUND_OPENING_PASSED: 'ROUND_OPENING_PASSED',
    NOT_RELOADING: 'NOT_RELOADING',
    NOT_PRONE: 'NOT_PRONE',
    NOT_GRAPPLED: 'NOT_GRAPPLED',
    NO_DROPPED_ITEM: 'NO_DROPPED_ITEM',
    NO_RESOURCE_POOL: 'NO_RESOURCE_POOL',
    NO_COMPATIBLE_MANEUVER: 'NO_COMPATIBLE_MANEUVER',
    TWO_WEAPON_UNAVAILABLE: 'TWO_WEAPON_UNAVAILABLE',
    NO_OPPORTUNITY: 'NO_OPPORTUNITY',
    FULL_DEFENSE_UNLEARNED: 'FULL_DEFENSE_UNLEARNED',
    NO_LEARNED_SUPERNATURAL: 'NO_LEARNED_SUPERNATURAL',
} as const;

export type ActionReasonCode = (typeof ACTION_REASON)[keyof typeof ACTION_REASON];

export const MANEUVER_REASON = {
    AVAILABLE: 'AVAILABLE',
    NOT_LEARNED: 'NOT_LEARNED',
    PASSIVE_OR_DEDICATED_ACTION: 'PASSIVE_OR_DEDICATED_ACTION',
    WEAPON_TYPE_MISMATCH: 'WEAPON_TYPE_MISMATCH',
    ATTRIBUTE_PREREQUISITE: 'ATTRIBUTE_PREREQUISITE',
    COMBAT_VALUE_PREREQUISITE: 'COMBAT_VALUE_PREREQUISITE',
    FREE_HANDS_PREREQUISITE: 'FREE_HANDS_PREREQUISITE',
    TECHNIQUE_PREREQUISITE: 'TECHNIQUE_PREREQUISITE',
    ABILITY_PREREQUISITE: 'ABILITY_PREREQUISITE',
} as const;

export type ManeuverReasonCode = (typeof MANEUVER_REASON)[keyof typeof MANEUVER_REASON];

export interface ManeuverEligibilityInput {
    learned: boolean;
    weaponType: 'MELEE' | 'RANGED';
    maneuverActionType?: string | null;
    maneuverType?: string | null;
    prerequisites?: Record<string, unknown> | null;
    attributes: Record<'mu' | 'in' | 'ge' | 'ff' | 'kk', number>;
    combatValue: number;
    handsFree: number;
    combatTechnique: string;
    learnedAbilityNames: string[];
}

/** Actor/equipment-side maneuver validation shared by menus and resolution. */
export function evaluateManeuverEligibility(input: ManeuverEligibilityInput): {
    available: boolean;
    reasonCode: ManeuverReasonCode;
    detail: string | null;
} {
    if (!input.learned) return { available: false, reasonCode: MANEUVER_REASON.NOT_LEARNED, detail: null };
    if (input.maneuverType && ['full_defense', 'masterful_parry', 'two_weapon_training'].includes(input.maneuverType)) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.PASSIVE_OR_DEDICATED_ACTION,
            detail: input.maneuverType,
        };
    }
    if (input.maneuverActionType && input.maneuverActionType !== input.weaponType) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.WEAPON_TYPE_MISMATCH,
            detail: input.maneuverActionType,
        };
    }
    const prerequisites = input.prerequisites ?? {};
    for (const attribute of ['mu', 'in', 'ge', 'ff', 'kk'] as const) {
        const required = prerequisites[attribute];
        if (Number.isInteger(required) && input.attributes[attribute] < Number(required)) {
            return {
                available: false,
                reasonCode: MANEUVER_REASON.ATTRIBUTE_PREREQUISITE,
                detail: `${attribute.toUpperCase()} ${required}`,
            };
        }
    }
    if (
        Number.isInteger(prerequisites.ge_or_kk) &&
        Math.max(input.attributes.ge, input.attributes.kk) < Number(prerequisites.ge_or_kk)
    ) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.ATTRIBUTE_PREREQUISITE,
            detail: `GE/KK ${prerequisites.ge_or_kk}`,
        };
    }
    if (Number.isInteger(prerequisites.value) && input.combatValue < Number(prerequisites.value)) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.COMBAT_VALUE_PREREQUISITE,
            detail: String(prerequisites.value),
        };
    }
    if (Number.isInteger(prerequisites.hands_free) && input.handsFree < Number(prerequisites.hands_free)) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.FREE_HANDS_PREREQUISITE,
            detail: String(prerequisites.hands_free),
        };
    }
    const techniques = [
        ...(typeof prerequisites.technique === 'string' ? [prerequisites.technique] : []),
        ...(Array.isArray(prerequisites.techniques)
            ? prerequisites.techniques.filter((value): value is string => typeof value === 'string')
            : []),
    ];
    if (techniques.length && !techniques.includes(input.combatTechnique)) {
        return {
            available: false,
            reasonCode: MANEUVER_REASON.TECHNIQUE_PREREQUISITE,
            detail: techniques.join(', '),
        };
    }
    const abilities = [
        ...(typeof prerequisites.requires === 'string' ? [prerequisites.requires] : []),
        ...(Array.isArray(prerequisites.requires)
            ? prerequisites.requires.filter((value): value is string => typeof value === 'string')
            : []),
    ];
    const missing = abilities.find(name => !input.learnedAbilityNames.includes(name));
    if (missing) {
        return { available: false, reasonCode: MANEUVER_REASON.ABILITY_PREREQUISITE, detail: missing };
    }
    return { available: true, reasonCode: MANEUVER_REASON.AVAILABLE, detail: null };
}

export interface ActionAvailabilityInput {
    activeTurn: boolean;
    incapacitated: boolean;
    actionSpent?: boolean;
    freeActionSpent?: boolean;
    reloading?: boolean;
    prone?: boolean;
    grappled?: boolean;
    hasDroppedItem?: boolean;
    hasResourcePool?: boolean;
    turnOpening?: boolean;
    hasCompatibleManeuver?: boolean;
    canUseTwoWeapons?: boolean;
    hasOpportunity?: boolean;
    canUseFullDefense?: boolean;
    hasLearnedSupernatural?: boolean;
}

/** Common availability for the Discord action picker and API clients. */
export function evaluateActionAvailability(input: ActionAvailabilityInput) {
    const turnReason: ActionReasonCode = !input.activeTurn
        ? ACTION_REASON.NOT_ACTIVE_TURN
        : input.incapacitated
          ? ACTION_REASON.INCAPACITATED
          : ACTION_REASON.AVAILABLE;
    const option = (
        specificUnavailable: boolean,
        reason: ActionReasonCode,
        kind: ActionKind = 'ACTION',
        consumesAction = kind === 'ACTION'
    ) => ({
        kind,
        available:
            turnReason === ACTION_REASON.AVAILABLE && !(consumesAction && input.actionSpent) && !specificUnavailable,
        reasonCode:
            turnReason !== ACTION_REASON.AVAILABLE
                ? turnReason
                : consumesAction && input.actionSpent
                  ? ACTION_REASON.ACTION_ALREADY_SPENT
                  : specificUnavailable
                    ? reason
                    : ACTION_REASON.AVAILABLE,
    });
    return {
        attack: option(false, ACTION_REASON.AVAILABLE),
        maneuver: option(input.hasCompatibleManeuver === false, ACTION_REASON.NO_COMPATIBLE_MANEUVER),
        twoWeapon: option(input.canUseTwoWeapons === false, ACTION_REASON.TWO_WEAPON_UNAVAILABLE),
        opportunity: option(input.hasOpportunity === false, ACTION_REASON.NO_OPPORTUNITY, 'SYSTEM_REACTION', false),
        fullDefense: option(
            input.turnOpening === false || input.canUseFullDefense === false,
            input.canUseFullDefense === false
                ? ACTION_REASON.FULL_DEFENSE_UNLEARNED
                : ACTION_REASON.ROUND_OPENING_PASSED
        ),
        reload: option(!input.reloading, ACTION_REASON.NOT_RELOADING),
        standUp: option(!input.prone, ACTION_REASON.NOT_PRONE),
        escapeGrapple: option(!input.grappled, ACTION_REASON.NOT_GRAPPLED),
        retrieveItem: option(!input.hasDroppedItem, ACTION_REASON.NO_DROPPED_ITEM),
        spellOrLiturgy: option(input.hasLearnedSupernatural === false, ACTION_REASON.NO_LEARNED_SUPERNATURAL),
        genericAction: option(false, ACTION_REASON.AVAILABLE),
        freeAction: option(Boolean(input.freeActionSpent), ACTION_REASON.ACTION_ALREADY_SPENT, 'FREE_ACTION', false),
        resource: option(!input.hasResourcePool, ACTION_REASON.NO_RESOURCE_POOL, 'SYSTEM_REACTION', false),
        endTurn: option(false, ACTION_REASON.AVAILABLE, 'FREE_ACTION', false),
    };
}

/** Official ranged-band modifiers: close +2 AT/+1 TP, medium 0, far -2 AT/-1 TP. */
export function getRangedBandModifiers(rangeBand: 'close' | 'medium' | 'far') {
    if (rangeBand === 'close') return { attack: 2, damage: 1, authority: 'CORE' as const };
    if (rangeBand === 'far') return { attack: -2, damage: -1, authority: 'CORE' as const };
    return { attack: 0, damage: 0, authority: 'CORE' as const };
}
