export const MAX_DICE_MACROS_PER_CHARACTER = 50;

export function normalizeDiceMacroName(input: string): string {
    const name = String(input ?? '')
        .trim()
        .toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
        throw new Error('Macro name must be 1-32 characters using letters, numbers, _ or -');
    }
    return name;
}
