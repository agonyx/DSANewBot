import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDiceRollBreakdown, normalizeDiceNotation, parseDiceNotation, rollNotation } from '../../utils/diceUtils';
import { normalizeDiceMacroName } from '../../utils/diceMacroUtils';
import { formatInlineRollReply, formatInlineRollResult, resolveInlineRolls } from '../../utils/inlineRolls';

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

    it('formats compact inline roll results with bounded dice detail', () => {
        const result = rollNotation('20w6+3', () => 4);
        assert.ok(result);
        const formatted = formatInlineRollResult(result);
        assert.match(formatted, /^🎲 \*\*20W6\+3\*\* → \[4, 4/);
        assert.match(formatted, /… \+8 dice\] \+ 3 = \*\*83\*\*$/);
    });

    it('resolves message inline rolls, reports invalid dice, and ignores wiki links', () => {
        const values = [2, 5];
        const batch = resolveInlineRolls('Try [[2w6+3]], [[1w1]], and [[Rules Index]].', () => values.shift()!);
        assert.equal(batch.rolls.length, 2);
        assert.equal(batch.rolls[0].result?.total, 10);
        assert.equal(batch.rolls[1].error, 'Invalid dice notation');
        assert.match(formatInlineRollReply(batch), /\*\*2W6\+3\*\*.*= \*\*10\*\*/);
    });

    it('caps inline processing and keeps the reply within Discord message limits', () => {
        const content = Array.from({ length: 14 }, () => '[[100w1000+1000000]]').join(' ');
        const reply = formatInlineRollReply(resolveInlineRolls(content, () => 1000));
        assert.match(reply, /4 omitted/);
        assert.ok(reply.length <= 2000, `reply was ${reply.length} characters`);
    });
});
