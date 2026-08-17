export type CatalogEffectType = 'DAMAGE' | 'HEAL' | 'BUFF' | 'CONDITION' | 'STATUS' | 'UTILITY';

export interface RegelwikiAbility {
    id: string;
    name: string;
    url?: string;
    breadcrumbs?: string[];
    properties?: Record<string, string>;
    description?: string;
}

export interface ParsedCatalogAbility {
    external_id: string;
    name: string;
    kind: string;
    probe_attr1: string | null;
    probe_attr2: string | null;
    probe_attr3: string | null;
    traditions: string[];
    feature: string | null;
    aspects: string[];
    resource_cost: number;
    permanent_cost: number;
    casting_time: string | null;
    casting_time_actions: number;
    casting_time_minutes: number;
    range: string | null;
    duration: string | null;
    target_category: string | null;
    advancement_factor: string | null;
    ap_cost: number;
    description: string | null;
    source_url: string | null;
    effect_type: CatalogEffectType;
    effect_data: Record<string, unknown>;
    raw_properties: Record<string, string>;
}

const ATTRIBUTE_CODES = new Set(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
const ADVANCEMENT_COST = { A: 1, B: 2, C: 3, D: 4 } as const;

export function parseProbe(value?: string): [string, string, string] | null {
    if (!value) return null;
    const codes = value
        .toUpperCase()
        .match(/\b(?:MU|KL|IN|CH|FF|GE|KO|KK)\b/g)
        ?.filter(code => ATTRIBUTE_CODES.has(code));
    return codes && codes.length >= 3 ? [codes[0], codes[1], codes[2]] : null;
}

export function parseResourceCost(value?: string): { cost: number; permanentCost: number } {
    if (!value) return { cost: 0, permanentCost: 0 };
    const numbers = [...value.matchAll(/\d+/g)].map(match => Number(match[0]));
    let cost = numbers[0] ?? 0;
    const minimum = value.match(/mindestens(?:\s+jedoch)?\s+(\d+)/i);
    if (minimum) cost = Math.max(cost, Number(minimum[1]));
    const permanent = value.match(/(?:davon\s+)?(\d+)\s+(?:davon\s+)?permanent/i);
    return { cost, permanentCost: permanent ? Number(permanent[1]) : 0 };
}

export function parseCastingMinutes(value?: string): number {
    if (!value) return 0;
    const amount = Number(value.match(/\d+(?:[.,]\d+)?/)?.[0].replace(',', '.') ?? 0);
    if (/stunde/i.test(value)) return Math.max(0, Math.ceil(amount * 60));
    if (/minute/i.test(value)) return Math.max(0, Math.ceil(amount));
    return 0;
}

export function parseCastingActions(value?: string): number {
    if (!value || !/aktion/i.test(value)) return 0;
    return Math.max(0, Number(value.match(/\d+/)?.[0] ?? 0));
}

export function splitTraditions(value?: string): string[] {
    if (!value) return [];
    const normalized = value.replace(/^Verbreitung\s*:\s*/i, '').trim();
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    for (const character of normalized) {
        if (character === '(') depth += 1;
        if (character === ')') depth = Math.max(0, depth - 1);
        if (character === ',' && depth === 0) {
            if (current.trim()) parts.push(current.trim());
            current = '';
        } else {
            current += character;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return [...new Set(parts)];
}

function extractAspects(traditions: string[]): string[] {
    return [
        ...new Set(
            traditions.flatMap(tradition => {
                const match = tradition.match(/\(([^)]+)\)/);
                return match
                    ? match[1]
                          .split(',')
                          .map(value => value.trim())
                          .filter(Boolean)
                    : [];
            })
        ),
    ];
}

function effectFor(
    name: string,
    powerSource: 'MAGIC' | 'KARMA'
): {
    type: CatalogEffectType;
    data: Record<string, unknown>;
} {
    if (['Ignifaxius', 'Fulminictus'].includes(name)) {
        return {
            type: 'DAMAGE',
            data: {
                formula: '2w6',
                qsMultiplier: 2,
                ignoresMundaneArmor: name === 'Fulminictus',
                ...(name === 'Ignifaxius'
                    ? { secondaryStatus: 'brennend', secondaryChance: { die: 6, maximum: 3 } }
                    : {}),
            },
        };
    }
    if (name === 'Balsam Salabunde' || name === 'Heilsegen') {
        return { type: 'HEAL', data: { resourceScaled: true, minimumAmount: 4 } };
    }
    if (name === 'Kleiner Heilsegen') return { type: 'HEAL', data: { amount: 1, oncePerDay: true } };
    if (name === 'Armatrutz') {
        return {
            type: 'BUFF',
            data: {
                resourceOptions: [4, 8, 16],
                armorByCost: { 4: 1, 8: 2, 16: 3 },
                durationMinutesPerQs: 3,
                target: 'SELF',
            },
        };
    }
    if (name === 'Paralysis') {
        return {
            type: 'CONDITION',
            data: { conditionType: 'paralyse', levelsByQs: [1, 1, 2, 3, 4, 4], durationMinutesPerQs: 3 },
        };
    }
    return {
        type: 'UTILITY',
        data: { narrative: true, powerSource },
    };
}

function mapKind(kind: string, powerSource: 'MAGIC' | 'KARMA'): string | null {
    if (powerSource === 'MAGIC') {
        if (kind === 'Zaubersprüche') return 'SPELL';
        if (kind === 'Rituale') return 'RITUAL';
        if (kind === 'Zaubertricks') return 'TRICK';
        return null;
    }
    if (kind === 'Liturgien') return 'LITURGY';
    if (kind === 'Zeremonien') return 'CEREMONY';
    if (kind === 'Segen') return 'BLESSING';
    return null;
}

export function parseCatalogAbility(
    entry: RegelwikiAbility,
    powerSource: 'MAGIC' | 'KARMA'
): ParsedCatalogAbility | null {
    const properties = entry.properties ?? {};
    const kind = mapKind(entry.breadcrumbs?.at(-1) ?? '', powerSource);
    if (!kind || !entry.id || !entry.name) return null;
    const probe = parseProbe(properties.Probe);
    const costText = powerSource === 'MAGIC' ? properties['AsP-Kosten'] : properties['KaP-Kosten'];
    const { cost, permanentCost } = parseResourceCost(costText);
    const castingTime =
        properties.Zauberdauer ??
        properties.Ritualdauer ??
        properties.Liturgiedauer ??
        properties.Zeremoniedauer ??
        null;
    const factor = properties.Steigerungsfaktor?.trim().toUpperCase() ?? null;
    const effect = effectFor(entry.name, powerSource);
    const distribution = splitTraditions(properties.Verbreitung ?? properties.Anmerkung);
    const simpleAbility = kind === 'TRICK' || kind === 'BLESSING';
    if (!simpleAbility && (!costText || !probe || distribution.length === 0)) return null;
    const requiresResourceInput = !simpleAbility && cost === 0;
    return {
        external_id: entry.id,
        name: entry.name,
        kind,
        probe_attr1: probe?.[0] ?? null,
        probe_attr2: probe?.[1] ?? null,
        probe_attr3: probe?.[2] ?? null,
        traditions: distribution,
        feature: properties.Merkmal ?? null,
        aspects: properties.Aspekt ? splitTraditions(properties.Aspekt) : extractAspects(distribution),
        resource_cost: simpleAbility || requiresResourceInput ? 1 : cost,
        permanent_cost: permanentCost,
        casting_time: castingTime,
        casting_time_actions: simpleAbility ? 1 : parseCastingActions(castingTime ?? undefined),
        casting_time_minutes: parseCastingMinutes(castingTime ?? undefined),
        range: properties.Reichweite ?? null,
        duration: properties.Wirkungsdauer ?? null,
        target_category: properties.Zielkategorie ?? null,
        advancement_factor: factor,
        ap_cost: factor && factor in ADVANCEMENT_COST ? ADVANCEMENT_COST[factor as keyof typeof ADVANCEMENT_COST] : 1,
        description: entry.description ?? properties.Wirkung ?? null,
        source_url: entry.url ?? null,
        effect_type: effect.type,
        effect_data: requiresResourceInput ? { ...effect.data, resourceInputRequired: true } : effect.data,
        raw_properties: properties,
    };
}
