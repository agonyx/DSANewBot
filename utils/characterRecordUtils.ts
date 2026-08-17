import { normalizeName, normalizeText } from './campaignUtils';

export const CHARACTER_RECORD_KINDS = [
    'FAMILIAR',
    'COMPANION',
    'MOUNT',
    'BACKGROUND',
    'REPUTATION',
    'CRAFTING_PROJECT',
    'ALCHEMY_BREW',
] as const;

export type CharacterRecordKind = (typeof CHARACTER_RECORD_KINDS)[number];

export function normalizeCharacterRecord(
    kind: CharacterRecordKind,
    input: { name: string; description?: string; status?: string; data?: Record<string, unknown> }
) {
    if (!CHARACTER_RECORD_KINDS.includes(kind as CharacterRecordKind)) {
        throw new Error('Invalid character record kind');
    }
    return {
        kind,
        name: normalizeName(input.name),
        status: normalizeName(input.status || 'ACTIVE', 'status', 40)
            .toUpperCase()
            .replace(/\s+/g, '_'),
        data: {
            ...(input.data || {}),
            description: normalizeText(input.description, 'description', 1500),
        },
    };
}

export function normalizeProgress(progress: number, target: number): { progress: number; target: number } {
    if (!Number.isInteger(target) || target < 1 || target > 100_000) {
        throw new Error('Target progress must be an integer from 1 to 100000');
    }
    if (!Number.isInteger(progress) || progress < 0 || progress > target) {
        throw new Error(`Progress must be an integer from 0 to ${target}`);
    }
    return { progress, target };
}

export function advanceProgress(
    data: Record<string, unknown>,
    amount: number
): { data: Record<string, unknown>; completed: boolean } {
    const current = Number(data.progress || 0);
    const target = Number(data.target || 1);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) {
        throw new Error('Progress amount must be an integer from 1 to 100000');
    }
    const progress = Math.min(target, current + amount);
    return { data: { ...data, progress, target }, completed: progress >= target };
}
