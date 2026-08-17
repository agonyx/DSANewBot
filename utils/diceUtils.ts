export const MAX_DICE_COUNT = 100;
export const MAX_DICE_SIDES = 1000;
export const MAX_DICE_MODIFIER = 1_000_000;

export interface ParsedDiceNotation {
    notation: string;
    count: number;
    sides: number;
    modifier: number;
}

export interface DiceRollResult extends ParsedDiceNotation {
    rolls: number[];
    total: number;
}

export function parseDiceNotation(input: string): ParsedDiceNotation | null {
    const candidate = String(input ?? '')
        .trim()
        .toLowerCase()
        .replace(/d/g, 'w')
        .replace(/\s+/g, '');
    const match = candidate.match(/^(\d+)?w(\d+)([+-]\d+)?$/);
    if (!match) return null;

    const count = match[1] ? Number(match[1]) : 1;
    const sides = Number(match[2]);
    const modifier = match[3] ? Number(match[3]) : 0;
    if (
        !Number.isSafeInteger(count) ||
        !Number.isSafeInteger(sides) ||
        !Number.isSafeInteger(modifier) ||
        count < 1 ||
        count > MAX_DICE_COUNT ||
        sides < 2 ||
        sides > MAX_DICE_SIDES ||
        Math.abs(modifier) > MAX_DICE_MODIFIER
    ) {
        return null;
    }

    const modifierText = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : String(modifier);
    return { notation: `${count}w${sides}${modifierText}`, count, sides, modifier };
}

export function normalizeDiceNotation(input: string): string {
    const parsed = parseDiceNotation(input);
    if (!parsed) {
        throw new Error(`Invalid dice notation (use 1-${MAX_DICE_COUNT} dice, 2-${MAX_DICE_SIDES} sides, e.g. 2w6+3)`);
    }
    return parsed.notation;
}

export function rollNotation(input: string, roller: (sides: number) => number): DiceRollResult | null {
    const parsed = parseDiceNotation(input);
    if (!parsed) return null;
    const rolls = Array.from({ length: parsed.count }, () => roller(parsed.sides));
    if (rolls.some(roll => !Number.isInteger(roll) || roll < 1 || roll > parsed.sides)) {
        throw new Error('Dice roller returned an out-of-range result');
    }
    return { ...parsed, rolls, total: rolls.reduce((sum, roll) => sum + roll, parsed.modifier) };
}

export function formatDiceRollBreakdown(result: DiceRollResult): string {
    const modifier =
        result.modifier > 0 ? ` + ${result.modifier}` : result.modifier < 0 ? ` - ${-result.modifier}` : '';
    return `${result.rolls.join(' + ')}${modifier}`;
}
