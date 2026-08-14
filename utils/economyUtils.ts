export const KREUZER_PER_HELLER = 10;
export const KREUZER_PER_SILBERTALER = 100;
export const KREUZER_PER_DUKATEN = 1000;

export interface CurrencyAmount {
    dukaten?: number;
    silbertaler?: number;
    heller?: number;
    kreuzer?: number;
}

function nonNegativeInteger(name: string, value: number | undefined): number {
    const normalized = value ?? 0;
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return normalized;
}

export function toKreuzer(amount: CurrencyAmount): number {
    const total =
        nonNegativeInteger('dukaten', amount.dukaten) * KREUZER_PER_DUKATEN +
        nonNegativeInteger('silbertaler', amount.silbertaler) * KREUZER_PER_SILBERTALER +
        nonNegativeInteger('heller', amount.heller) * KREUZER_PER_HELLER +
        nonNegativeInteger('kreuzer', amount.kreuzer);
    if (!Number.isSafeInteger(total)) throw new Error('Currency amount is too large');
    return total;
}

export function fromKreuzer(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Kreuzer balance must be a non-negative integer');
    let remaining = value;
    const dukaten = Math.floor(remaining / KREUZER_PER_DUKATEN);
    remaining %= KREUZER_PER_DUKATEN;
    const silbertaler = Math.floor(remaining / KREUZER_PER_SILBERTALER);
    remaining %= KREUZER_PER_SILBERTALER;
    const heller = Math.floor(remaining / KREUZER_PER_HELLER);
    const kreuzer = remaining % KREUZER_PER_HELLER;
    return { dukaten, silbertaler, heller, kreuzer, totalKreuzer: value };
}

export function formatCurrency(value: number): string {
    const amount = fromKreuzer(value);
    return `${amount.dukaten} D / ${amount.silbertaler} S / ${amount.heller} H / ${amount.kreuzer} K`;
}

export function calculateSellValue(unitPriceKreuzer: number, quantity = 1): number {
    if (!Number.isInteger(unitPriceKreuzer) || unitPriceKreuzer < 0) throw new Error('Unit price must be non-negative');
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be a positive integer');
    return Math.floor(unitPriceKreuzer / 2) * quantity;
}

export interface CarryStateInput {
    strength: number;
    carriedWeightGrams: number;
    equippedArmorWeightGrams?: number;
    armorRs?: number;
    armorBe?: number;
    naturalArmor?: number;
}

export function calculateCarryState(input: CarryStateInput) {
    const strength = Number.isFinite(input.strength) ? Math.max(0, Math.trunc(input.strength)) : 0;
    const totalWeightGrams = Math.max(0, Math.trunc(input.carriedWeightGrams));
    const armorWeightGrams = Math.min(totalWeightGrams, Math.max(0, Math.trunc(input.equippedArmorWeightGrams ?? 0)));
    const loadWeightGrams = totalWeightGrams - armorWeightGrams;
    const carryingCapacityGrams = strength * 2000;
    const excessWeightGrams = Math.max(0, loadWeightGrams - carryingCapacityGrams);
    const loadEncumbrance = Math.min(4, Math.floor(excessWeightGrams / 4000));
    const armorEncumbrance = Math.max(0, Math.trunc(input.armorBe ?? 0));
    const encumbrance = Math.min(4, armorEncumbrance + loadEncumbrance);
    const armorSoak = Math.max(0, Math.trunc(input.naturalArmor ?? 0) + Math.trunc(input.armorRs ?? 0));
    return {
        strength,
        totalWeightGrams,
        armorWeightGrams,
        loadWeightGrams,
        carryingCapacityGrams,
        excessWeightGrams,
        loadEncumbrance,
        armorEncumbrance,
        encumbrance,
        armorSoak,
    };
}

export interface LootCandidate {
    id: string;
    name: string;
    category: string;
    priceKreuzer: number;
}

const LOOT_TIERS = {
    1: { currencyMin: 50, currencyMax: 250, itemCount: 1, maximumItemPrice: 5_000 },
    2: { currencyMin: 250, currencyMax: 1_000, itemCount: 2, maximumItemPrice: 25_000 },
    3: { currencyMin: 1_000, currencyMax: 5_000, itemCount: 3, maximumItemPrice: Number.MAX_SAFE_INTEGER },
} as const;

function normalizedRandom(random: () => number): number {
    const result = random();
    if (!Number.isFinite(result)) throw new Error('Loot random source must return a finite number');
    return Math.min(0.9999999999999999, Math.max(0, result));
}

export function generateLootPlan(candidates: LootCandidate[], tier: number, random: () => number = Math.random) {
    if (!Number.isInteger(tier) || tier < 1 || tier > 3) throw new Error('Loot tier must be 1, 2, or 3');
    const settings = LOOT_TIERS[tier as keyof typeof LOOT_TIERS];
    const currencyRemainingKreuzer =
        settings.currencyMin + Math.floor(normalizedRandom(random) * (settings.currencyMax - settings.currencyMin + 1));
    const available = candidates.filter(
        candidate =>
            candidate.id &&
            candidate.name &&
            Number.isSafeInteger(candidate.priceKreuzer) &&
            candidate.priceKreuzer > 0 &&
            candidate.priceKreuzer <= settings.maximumItemPrice
    );
    const entries: Array<LootCandidate & { quantity: number }> = [];
    while (available.length > 0 && entries.length < settings.itemCount) {
        const index = Math.floor(normalizedRandom(random) * available.length);
        entries.push({ ...available[index], quantity: 1 });
        available.splice(index, 1);
    }
    return { tier, currencyRemainingKreuzer, entries };
}
