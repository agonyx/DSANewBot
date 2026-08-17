import { normalizeName } from './campaignUtils';

const ATTRIBUTES = ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'] as const;
type Attribute = (typeof ATTRIBUTES)[number];

export interface CharacterImportResult {
    source: 'DSANEWBOT' | 'FOUNDRY_DSA5' | 'OPTOLITH' | 'DSA_PDF_1_93';
    profileId?: string;
    name: string;
    stats: Record<string, number>;
    background?: { culture?: string; profession?: string; species?: string };
    talents?: Array<{ name: string; value: number; notes?: string }>;
    combatTechniques?: Array<{ name: string; value: number; at?: number; pa?: number }>;
    weapons?: Array<{
        name: string;
        type: 'MELEE' | 'RANGED';
        combatTechnique?: string;
        tp?: string;
        at?: number;
        pa?: number;
        rangeClose?: number;
        rangeMedium?: number;
        rangeFar?: number;
        reloadActions?: number;
        isTwoHanded?: boolean;
        shieldPaBonus?: number;
        weightGrams?: number;
        isEquipped?: boolean;
    }>;
    armor?: Array<{
        name: string;
        armorRs: number;
        armorBe: number;
        area?: string;
        weightGrams?: number;
        isEquipped?: boolean;
    }>;
    zonedArmor?: Array<{ name: string; zones: Record<string, string> }>;
    specialAbilities?: Array<{ name: string; category?: string }>;
    spells?: Array<{ name: string; value: number }>;
    liturgies?: Array<{ name: string; value: number }>;
    combinedSupernatural?: Array<{ name: string; value: number }>;
    advantages?: string[];
    disadvantages?: string[];
    unresolvedFields?: string[];
    unresolvedFieldCount?: number;
    warnings?: string[];
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function at(root: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => object(value)[key], root);
}

function numberAt(root: unknown, paths: string[], fallback = 0): number {
    for (const path of paths) {
        const value = at(root, path);
        if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
            return Math.round(Number(value));
    }
    return fallback;
}

function bounded(value: number, label: string, min = 0, max = 100_000): number {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${label} must be an integer from ${min} to ${max}`);
    }
    return value;
}

function foundryCharacteristic(root: unknown, key: Attribute): number {
    const base = at(root, `system.characteristics.${key}`);
    const direct = numberAt(base, ['value'], Number.NaN);
    if (Number.isFinite(direct)) return direct;
    return ['initial', 'species', 'modifier', 'advances'].reduce((sum, part) => sum + numberAt(base, [part]), 0);
}

function parseFoundry(root: Record<string, unknown>): CharacterImportResult {
    const stats: Record<string, number> = {};
    for (const key of ATTRIBUTES) stats[key] = bounded(foundryCharacteristic(root, key), key.toUpperCase(), 0, 30);
    const maxLife = numberAt(root, ['system.status.wounds.max', 'system.status.lifePoints.max']);
    const currentLife = numberAt(root, ['system.status.wounds.value', 'system.status.lifePoints.value'], maxLife);
    Object.assign(stats, {
        le_max: bounded(maxLife, 'maximum life points'),
        le_current: bounded(currentLife, 'current life points'),
        asp_max: bounded(numberAt(root, ['system.status.astralenergy.max']), 'maximum astral energy'),
        asp_current: bounded(numberAt(root, ['system.status.astralenergy.value']), 'current astral energy'),
        kap_max: bounded(numberAt(root, ['system.status.karmaenergy.max']), 'maximum karma energy'),
        kap_current: bounded(numberAt(root, ['system.status.karmaenergy.value']), 'current karma energy'),
        schicksalspunkte_max: bounded(numberAt(root, ['system.status.fatePoints.max']), 'maximum fate points'),
        schicksalspunkte_current: bounded(numberAt(root, ['system.status.fatePoints.value']), 'current fate points'),
        initiative: bounded(numberAt(root, ['system.status.initiative.value']), 'initiative', -1000),
        ausweichen: bounded(numberAt(root, ['system.status.dodge.value']), 'dodge', -1000),
    });
    return {
        source: 'FOUNDRY_DSA5',
        name: normalizeName(String(root.name || ''), 'character name'),
        stats,
        background: {
            culture: String(at(root, 'system.details.culture.value') || '').trim() || undefined,
            profession: String(at(root, 'system.details.profession.value') || '').trim() || undefined,
        },
    };
}

function parseOptolith(root: Record<string, unknown>): CharacterImportResult {
    const stats = Object.fromEntries(ATTRIBUTES.map(key => [key, 8])) as Record<string, number>;
    for (const entry of Array.isArray(root.attributes) ? root.attributes : []) {
        const row = object(entry);
        const id = numberAt(row, ['id']);
        if (id >= 1 && id <= ATTRIBUTES.length) {
            stats[ATTRIBUTES[id - 1]] = bounded(numberAt(row, ['value'], 8), `attribute ${id}`, 0, 30);
        }
    }
    const derived = object(root.derived_characteristics);
    const lifeMax = numberAt(derived, ['life_points.maximum']);
    Object.assign(stats, {
        le_max: bounded(lifeMax, 'maximum life points'),
        le_current: bounded(lifeMax, 'current life points'),
        asp_max: bounded(numberAt(derived, ['arcane_energy.maximum']), 'maximum astral energy'),
        asp_current: bounded(numberAt(derived, ['arcane_energy.maximum']), 'current astral energy'),
        kap_max: bounded(numberAt(derived, ['karma_points.maximum', 'karma_energy.maximum']), 'maximum karma energy'),
        kap_current: bounded(
            numberAt(derived, ['karma_points.maximum', 'karma_energy.maximum']),
            'current karma energy'
        ),
        initiative: bounded(numberAt(derived, ['initiative.value']), 'initiative', -1000),
        ausweichen: bounded(numberAt(derived, ['dodge.value']), 'dodge', -1000),
    });
    const culture = object(root.culture);
    const profession = object(root.profession);
    return {
        source: 'OPTOLITH',
        name: normalizeName(String(root.name || at(root, 'personal_data.name') || ''), 'character name'),
        stats,
        background: {
            culture: culture.id ? `Optolith culture #${culture.id}` : undefined,
            profession:
                String(profession.custom_name || '').trim() ||
                (profession.id ? `Optolith profession #${profession.id}` : undefined),
        },
    };
}

function parseNative(root: Record<string, unknown>): CharacterImportResult {
    const rawStats = object(root.stats);
    const stats: Record<string, number> = {};
    for (const key of [
        ...ATTRIBUTES,
        'le_max',
        'le_current',
        'asp_max',
        'asp_current',
        'kap_max',
        'kap_current',
        'schicksalspunkte_max',
        'schicksalspunkte_current',
        'initiative',
        'ausweichen',
    ]) {
        if (rawStats[key] !== undefined)
            stats[key] = bounded(numberAt(rawStats, [key]), key, key === 'initiative' ? -1000 : 0);
    }
    return {
        source: 'DSANEWBOT',
        name: normalizeName(String(root.name || ''), 'character name'),
        stats,
        background: object(root.background) as CharacterImportResult['background'],
    };
}

export function parseCharacterImport(value: unknown): CharacterImportResult {
    const root = object(value);
    if (!Object.keys(root).length) throw new Error('Character import must be a JSON object');
    if (root.format === 'dsanewbot-character-v1') return parseNative(root);
    if (root.system && root.name) return parseFoundry(root);
    if (Array.isArray(root.attributes) && root.derived_characteristics) return parseOptolith(root);
    throw new Error('Unsupported character JSON. Use a Foundry DSA5, Optolith, or DSANewBot export.');
}
