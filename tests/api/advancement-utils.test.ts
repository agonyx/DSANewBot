import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAdvancementCost, calculateAttributeCost, calculateTalentCap } from '../../utils/advancementUtils';

describe('DSA advancement costs', () => {
    it('applies columns A-D to the official target-value progression', () => {
        assert.equal(calculateAdvancementCost('A', 1), 1);
        assert.equal(calculateAdvancementCost('B', 12), 2);
        assert.equal(calculateAdvancementCost('C', 13), 6);
        assert.equal(calculateAdvancementCost('D', 14), 12);
        assert.equal(calculateAdvancementCost('D', 18), 32);
        assert.equal(calculateAdvancementCost('C', 19), 30);
        assert.throws(() => calculateAdvancementCost('E', 1), /factor/i);
        assert.throws(() => calculateAdvancementCost('A', 0), /positive integer/i);
    });

    it('prices attributes from their target value', () => {
        assert.equal(calculateAttributeCost(14), 15);
        assert.equal(calculateAttributeCost(15), 30);
        assert.equal(calculateAttributeCost(16), 45);
    });

    it('caps talents at the highest participating attribute plus two', () => {
        assert.equal(calculateTalentCap([12, 10, 9]), 14);
        assert.equal(calculateTalentCap([8, 17, 11]), 19);
        assert.throws(() => calculateTalentCap([]), /attribute values/i);
    });
});
