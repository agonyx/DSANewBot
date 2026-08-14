export interface RegelwikiSpecialAbility {
    id?: string;
    name?: string;
    url?: string;
    subcategory?: string;
    description?: string;
    properties?: Record<string, string>;
}

export type SpecialAbilityCategory = 'MAGICAL' | 'KARMAL';

/** Only unambiguous fixed-cost rows are executable; tiered/variable values remain source reference data. */
export function parseFixedApCost(value: string | undefined): number | null {
    const match = value?.trim().match(/^(\d+)\s+Abenteuerpunkte$/i);
    if (!match) return null;
    const cost = Number(match[1]);
    return Number.isSafeInteger(cost) && cost > 0 ? cost : null;
}

export function parseSpecialAbility(entry: RegelwikiSpecialAbility, category: SpecialAbilityCategory) {
    const externalId = entry.id?.trim();
    const name = entry.name?.trim();
    const properties = entry.properties ?? {};
    const apCost = parseFixedApCost(properties['AP-Wert']);
    if (!externalId || !name || apCost === null) return null;

    const prerequisites = properties.Voraussetzung?.trim() || null;
    return {
        external_id: externalId,
        name,
        category,
        subcategory: entry.subcategory?.trim() || null,
        description: properties.Regel?.trim() || entry.description?.trim() || null,
        source_url: entry.url?.trim() || null,
        ap_cost: apCost,
        prerequisites,
        requires_confirmation: Boolean(prerequisites && !/^keine$/i.test(prerequisites)),
        raw_properties: properties,
    };
}
