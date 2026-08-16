/** Pure rules for condition/status modifiers, duration ticks, and attack context. */

export const CONDITION_TYPES = [
    'betaeubung',
    'verwirrung',
    'furcht',
    'paralyse',
    'belastung',
    'ueberanstrengung',
    'berauscht',
    'entrueckung',
    'trance',
] as const;

export const STATUS_TYPES = [
    'blutend',
    'bewusstlos',
    'blind',
    'brennend',
    'handlungsunfaehig',
    'liegend',
    'stumm',
    'taub',
    'ueberrascht',
    'unsichtbar',
    'vergiftet',
    'krank',
    'fixiert',
    'eingeengt',
    'bewegungsunfaehig',
] as const;

export const DURATION_TYPES = ['rounds', 'minutes', 'hours', 'rest', 'permanent'] as const;
export const CREATURE_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'] as const;
export const HIT_ZONES = ['head', 'torso', 'left_arm', 'right_arm', 'left_leg', 'right_leg'] as const;
export const RANGE_BANDS = ['close', 'medium', 'far'] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];
export type StatusType = (typeof STATUS_TYPES)[number];
export type DurationType = (typeof DURATION_TYPES)[number];
export type CreatureSize = (typeof CREATURE_SIZES)[number];
export type HitZone = (typeof HIT_ZONES)[number];
export type RangeBand = (typeof RANGE_BANDS)[number];

export interface ConditionState {
    condition_type: string;
    level: number;
}

export interface StatusEffectData {
    damagePerRound?: number;
    damageProgressionPerRound?: number;
    maxDamagePerRound?: number;
    checkPenalty?: number;
    atPenalty?: number;
    paPenalty?: number;
}

export interface StatusState {
    status_type: string;
    effect_data?: unknown;
}

export interface BuffState {
    at_modifier?: number;
    pa_modifier?: number;
    damage_modifier?: number;
    armor_modifier?: number;
    check_modifier?: number;
    prohibits_actions?: boolean;
    prohibits_defense?: boolean;
}

export interface CombatModifiers {
    checkPenalty: number;
    checkModifier: number;
    atModifier: number;
    paModifier: number;
    damageModifier: number;
    armorModifier: number;
    prohibitsActions: boolean;
    prohibitsDefense: boolean;
}

const DIRECT_INCAPACITATION = new Set(['bewusstlos', 'handlungsunfaehig']);

function integer(value: unknown, fallback = 0): number {
    return Number.isFinite(value) ? Math.trunc(value as number) : fallback;
}

export function isConditionType(value: string): value is ConditionType {
    return CONDITION_TYPES.includes(value as ConditionType);
}

export function isStatusType(value: string): value is StatusType {
    return STATUS_TYPES.includes(value as StatusType);
}

export function isDurationType(value: string): value is DurationType {
    return DURATION_TYPES.includes(value as DurationType);
}

export function validateStatusEffectData(value: unknown): StatusEffectData {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('effectData must be an object');
    const input = value as Record<string, unknown>;
    const allowed = new Set([
        'damagePerRound',
        'damageProgressionPerRound',
        'maxDamagePerRound',
        'checkPenalty',
        'atPenalty',
        'paPenalty',
    ]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new Error(`Unsupported status effect field: ${key}`);
        const amount = input[key];
        if (!Number.isInteger(amount) || (amount as number) < 0 || (amount as number) > 20) {
            throw new Error(`${key} must be an integer from 0 to 20`);
        }
    }
    return input as StatusEffectData;
}

export function statusData(status: StatusState): StatusEffectData {
    try {
        return validateStatusEffectData(status.effect_data);
    } catch {
        return {};
    }
}

export function calculateCombatModifiers(
    conditions: ConditionState[],
    statuses: StatusState[],
    effects: BuffState[],
    painLevel = 0
): CombatModifiers {
    const conditionLevels = conditions.reduce((sum, condition) => sum + Math.max(0, integer(condition.level)), 0);
    let checkPenalty = Math.min(5, Math.max(0, integer(painLevel)) + conditionLevels);
    let checkModifier = -checkPenalty;
    let atModifier = checkModifier;
    let paModifier = checkModifier;
    let damageModifier = 0;
    let armorModifier = 0;
    let prohibitsActions =
        Math.max(0, integer(painLevel)) >= 4 || conditionLevels >= 8 || conditions.some(c => integer(c.level) >= 4);
    let prohibitsDefense = prohibitsActions;

    for (const status of statuses) {
        const data = statusData(status);
        checkPenalty += integer(data.checkPenalty);
        checkModifier -= integer(data.checkPenalty);
        atModifier -= integer(data.checkPenalty);
        paModifier -= integer(data.checkPenalty);
        atModifier -= integer(data.atPenalty);
        paModifier -= integer(data.paPenalty);
        if (status.status_type === 'liegend') {
            atModifier -= 4;
            paModifier -= 2;
        }
        if (status.status_type === 'blind') {
            atModifier -= 4;
            paModifier -= 4;
        }
        if (status.status_type === 'ueberrascht') prohibitsDefense = true;
        if (DIRECT_INCAPACITATION.has(status.status_type)) {
            prohibitsActions = true;
            prohibitsDefense = true;
        }
    }

    for (const effect of effects) {
        atModifier += integer(effect.at_modifier);
        paModifier += integer(effect.pa_modifier);
        damageModifier += integer(effect.damage_modifier);
        armorModifier += integer(effect.armor_modifier);
        atModifier += integer(effect.check_modifier);
        paModifier += integer(effect.check_modifier);
        checkModifier += integer(effect.check_modifier);
        prohibitsActions ||= Boolean(effect.prohibits_actions);
        prohibitsDefense ||= Boolean(effect.prohibits_defense);
    }

    return {
        checkPenalty,
        checkModifier,
        atModifier,
        paModifier,
        damageModifier,
        armorModifier,
        prohibitsActions,
        prohibitsDefense,
    };
}

export function getStatusDamage(status: StatusState): number {
    const configured = integer(statusData(status).damagePerRound);
    if (configured > 0) return configured;
    return ['blutend', 'brennend', 'vergiftet'].includes(status.status_type) ? 1 : 0;
}

export function progressStatusEffectData(status: StatusState): StatusEffectData {
    const current = statusData(status);
    const progression = integer(current.damageProgressionPerRound);
    if (progression <= 0) return current;
    const maximum = Math.max(1, integer(current.maxDamagePerRound, 20));
    return {
        ...current,
        damagePerRound: Math.min(maximum, integer(current.damagePerRound) + progression),
    };
}

export function nextDuration(current: number | null | undefined): { remaining: number | null; expired: boolean } {
    if (current === null || current === undefined) return { remaining: null, expired: false };
    const remaining = Math.max(0, integer(current) - 1);
    return { remaining, expired: remaining === 0 };
}

export function getMultipleDefensePenalty(defenseCount: number, penaltyStep = 3): number {
    return Math.max(0, integer(defenseCount)) * Math.max(0, integer(penaltyStep, 3));
}

export function getCalledShotPenalty(zone: HitZone): number {
    if (zone === 'head') return -10;
    if (zone === 'torso') return -4;
    return -8;
}

export function resolveHumanoidHitZone(roll: number, size: CreatureSize = 'medium'): HitZone {
    const normalized = Math.min(20, Math.max(1, integer(roll, 1)));
    let region: 'head' | 'torso' | 'arms' | 'legs';
    if (size === 'tiny' || size === 'small')
        region = normalized <= 6 ? 'head' : normalized <= 10 ? 'torso' : normalized <= 18 ? 'arms' : 'legs';
    else if (size === 'large' || size === 'huge')
        region = normalized <= 2 ? 'head' : normalized <= 6 ? 'torso' : normalized <= 16 ? 'arms' : 'legs';
    else region = normalized <= 2 ? 'head' : normalized <= 12 ? 'torso' : normalized <= 16 ? 'arms' : 'legs';
    if (region === 'head' || region === 'torso') return region;
    const side = normalized % 2 === 0 ? 'right' : 'left';
    return `${side}_${region === 'arms' ? 'arm' : 'leg'}` as HitZone;
}

export function getRangePenalty(rangeBand: RangeBand): number {
    if (rangeBand === 'close') return 2;
    if (rangeBand === 'far') return -2;
    return 0;
}

export function getTwoWeaponPenalties(trainingPenalties: number[] = []): {
    mainHand: number;
    offHand: number;
} {
    const valid = trainingPenalties.filter(value => Number.isInteger(value) && value >= -2 && value <= 0);
    const mainHand = valid.length > 0 ? Math.max(...valid) : -2;
    return { mainHand, offHand: mainHand - 4 };
}
