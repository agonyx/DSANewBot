export const ATTRIBUTE_KEYS = ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export const ADVANCEMENT_FACTORS = ['A', 'B', 'C', 'D'] as const;
export type AdvancementFactor = (typeof ADVANCEMENT_FACTORS)[number];

const FACTOR_MULTIPLIER: Record<AdvancementFactor, number> = { A: 1, B: 2, C: 3, D: 4 };

function assertTarget(target: number): void {
    if (!Number.isInteger(target) || target < 1) throw new Error('Target value must be a positive integer');
}

/** DSA 5 column cost for buying the next level of a talent, spell, or liturgy. */
export function calculateAdvancementCost(factor: string, target: number): number {
    assertTarget(target);
    const normalized = factor.toUpperCase() as AdvancementFactor;
    const multiplier = FACTOR_MULTIPLIER[normalized];
    if (!multiplier) throw new Error(`Unknown advancement factor: ${factor}`);

    const base = target <= 12 ? 1 : target <= 18 ? [2, 3, 4, 5, 6, 8][target - 13] : 2 * (target - 14);
    return base * multiplier;
}

/** Attribute increases cost 15 AP per point of the target value above 13. */
export function calculateAttributeCost(target: number): number {
    assertTarget(target);
    return Math.max(15, 15 * (target - 13));
}

/** Talents may be raised to the highest participating attribute + 2. */
export function calculateTalentCap(attributeValues: readonly number[]): number {
    if (attributeValues.length === 0 || attributeValues.some(value => !Number.isInteger(value) || value < 0)) {
        throw new Error('Attribute values must be non-negative integers');
    }
    return Math.max(...attributeValues) + 2;
}

export function isAttributeKey(value: string): value is AttributeKey {
    return (ATTRIBUTE_KEYS as readonly string[]).includes(value.toLowerCase());
}
