import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiceRollBreakdown, normalizeDiceNotation, parseDiceNotation, rollNotation } from '../../utils/diceUtils';
import { normalizeDiceMacroName } from '../../utils/diceMacroUtils';

describe('dice utilities', () => {
    it('normalizes common d/w notation into a stable saved expression', () => {
        assert.deepEqual(parseDiceNotation(' 2D8 + 3 '), {
            notation: '2w8+3',
            count: 2,
            sides: 8,
            modifier: 3,
        });
        assert.equal(normalizeDiceNotation('w20-2'), '1w20-2');
    });

    it('rejects malformed or unsafe expressions', () => {
        for (const input of ['0w6', '101w6', '1w1', '1w1001', '1w6+1000001', 'process.exit()']) {
            assert.equal(parseDiceNotation(input), null, input);
        }
        assert.throws(() => normalizeDiceNotation('nope'), /Invalid dice notation/);
    });

    it('rolls through an injected roller and formats the breakdown', () => {
        const values = [2, 5];
        const result = rollNotation('2w6+3', () => values.shift()!);
        assert.ok(result);
        assert.deepEqual(result.rolls, [2, 5]);
        assert.equal(result.total, 10);
        assert.equal(formatDiceRollBreakdown(result), '2 + 5 + 3');
    });

    it('normalizes safe macro names', () => {
        assert.equal(normalizeDiceMacroName('  DAMAGE_1 '), 'damage_1');
        assert.throws(() => normalizeDiceMacroName('../damage'), /Macro name/);
        assert.throws(() => normalizeDiceMacroName('two words'), /Macro name/);
    });
});
