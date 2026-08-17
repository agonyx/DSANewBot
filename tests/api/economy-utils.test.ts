import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateCarryState,
    calculateSellValue,
    formatCurrency,
    fromKreuzer,
    generateLootPlan,
    toKreuzer,
} from '../../utils/economyUtils';

describe('currency and sale rules', () => {
    it('converts the four coin denominations without losing Kreuzer', () => {
        assert.equal(toKreuzer({ dukaten: 2, silbertaler: 3, heller: 4, kreuzer: 5 }), 2345);
        assert.deepEqual(fromKreuzer(2345), {
            dukaten: 2,
            silbertaler: 3,
            heller: 4,
            kreuzer: 5,
            totalKreuzer: 2345,
        });
        assert.equal(formatCurrency(2345), '2 D / 3 S / 4 H / 5 K');
    });

    it('uses half unit value rounded down for sales', () => {
        assert.equal(calculateSellValue(101), 50);
        assert.equal(calculateSellValue(101, 3), 150);
    });
});

describe('carrying capacity, armor, and Belastung', () => {
    it('allows KK × 2 Stein and adds one level for each full extra 4 Stein', () => {
        assert.equal(calculateCarryState({ strength: 14, carriedWeightGrams: 31_999 }).loadEncumbrance, 0);
        assert.equal(calculateCarryState({ strength: 14, carriedWeightGrams: 32_000 }).loadEncumbrance, 1);
        assert.equal(calculateCarryState({ strength: 14, carriedWeightGrams: 36_000 }).loadEncumbrance, 2);
    });

    it('excludes worn armor weight but combines armor BE and natural RS', () => {
        const state = calculateCarryState({
            strength: 10,
            carriedWeightGrams: 27_000,
            equippedArmorWeightGrams: 5_000,
            armorRs: 3,
            armorBe: 1,
            naturalArmor: 2,
        });
        assert.equal(state.loadWeightGrams, 22_000);
        assert.equal(state.loadEncumbrance, 0);
        assert.equal(state.encumbrance, 1);
        assert.equal(state.armorSoak, 5);
    });
});

describe('tiered loot plans', () => {
    const candidates = [
        { id: 'cheap', name: 'Torch', category: 'GEAR', priceKreuzer: 50 },
        { id: 'middle', name: 'Sword', category: 'WEAPON', priceKreuzer: 20_000 },
        { id: 'expensive', name: 'Plate', category: 'ARMOR', priceKreuzer: 250_000 },
    ];

    it('is deterministic with an injected random source and respects tier value caps', () => {
        const plan = generateLootPlan(candidates, 1, () => 0);
        assert.equal(plan.currencyRemainingKreuzer, 50);
        assert.deepEqual(
            plan.entries.map(entry => entry.id),
            ['cheap']
        );
    });

    it('selects unique entries and validates the tier', () => {
        const plan = generateLootPlan(candidates, 3, () => 0);
        assert.deepEqual(
            plan.entries.map(entry => entry.id),
            ['cheap', 'middle', 'expensive']
        );
        assert.throws(() => generateLootPlan(candidates, 4), /tier/i);
    });
});
