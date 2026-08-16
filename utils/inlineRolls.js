const { rollNotation } = require('./diceUtils');

const MAX_INLINE_ROLLS = 10;

function escapeMarkdown(value) {
    return value.replace(/[\\`*_{}[\]()#+\-.!|>~]/g, '\\$&');
}

/** Compact, consistent Discord rendering shared by message and slash-command rolls. */
function formatInlineRollResult(result) {
    const visibleRolls = result.rolls.slice(0, 12).join(', ');
    const omittedRolls = result.rolls.length - 12;
    const rollList = omittedRolls > 0 ? `${visibleRolls}, … +${omittedRolls} dice` : visibleRolls;
    const modifier =
        result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${-result.modifier}` : '';
    return `🎲 **${result.notation.toUpperCase()}** → [${rollList}]${modifier} = **${result.total}**`;
}

/** Resolve Roll20-style [[dice]] expressions without treating ordinary [[wiki links]] as rolls. */
function resolveInlineRolls(content, roller, maxRolls = MAX_INLINE_ROLLS) {
    const candidates = [...String(content ?? '').matchAll(/\[\[([^[\]]{1,64})\]\]/g)]
        .map(match => match[1].trim())
        .filter(expression => /^(?:\d+)?[wd]\d+/i.test(expression));
    const selected = candidates.slice(0, Math.max(0, maxRolls));
    const rolls = selected.map(expression => {
        const result = rollNotation(expression, roller);
        return result
            ? { expression, result, error: null }
            : { expression, result: null, error: 'Invalid dice notation' };
    });
    return { rolls, omitted: Math.max(0, candidates.length - selected.length) };
}

function formatInlineRollReply(batch) {
    const lines = batch.rolls.map(roll =>
        roll.result
            ? formatInlineRollResult(roll.result)
            : `❌ **${escapeMarkdown(roll.expression.toUpperCase())}** → ${roll.error}`
    );
    if (batch.omitted > 0) {
        lines.push(`_Only the first ${batch.rolls.length} inline rolls were processed; ${batch.omitted} omitted._`);
    }
    return lines.join('\n');
}

module.exports = {
    MAX_INLINE_ROLLS,
    formatInlineRollReply,
    formatInlineRollResult,
    resolveInlineRolls,
};
