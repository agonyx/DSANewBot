import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { specialAbilities } from '../db/schema';
import { canonicalizeCatalogRows } from '../utils/catalogSeedUtils';
import {
    parseSpecialAbility,
    type RegelwikiSpecialAbility,
    type SpecialAbilityCategory,
} from '../utils/specialAbilityCatalogUtils';

const DATA_ROOT = path.resolve(__dirname, '../DSA5WikiScraper/dsa_scraper_v3/data/json');
const SOURCES: Array<{ file: string; category: SpecialAbilityCategory }> = [
    { file: 'special_abilities_magical.json', category: 'MAGICAL' },
    { file: 'special_abilities_karmale.json', category: 'KARMAL' },
];

async function loadSource(fileName: string): Promise<RegelwikiSpecialAbility[]> {
    const raw = await readFile(path.join(DATA_ROOT, fileName), 'utf8');
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error(`${fileName} must contain a JSON array`);
    return value as RegelwikiSpecialAbility[];
}

async function loadParsedSpecialAbilityCatalog() {
    const sources = await Promise.all(
        SOURCES.map(async source => ({ ...source, entries: await loadSource(source.file) }))
    );
    return sources.flatMap(source =>
        source.entries
            .map(entry => parseSpecialAbility(entry, source.category))
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    );
}

export async function loadSpecialAbilityCatalog() {
    const parsedRows = await loadParsedSpecialAbilityCatalog();
    return canonicalizeCatalogRows(
        parsedRows,
        row => {
            const { external_id: _externalId, source_url: _sourceUrl, ...rules } = row;
            return JSON.stringify(rules);
        },
        true
    ).rows;
}

export async function seedSpecialAbilityCatalog() {
    const parsedRows = await loadParsedSpecialAbilityCatalog();
    const catalog = canonicalizeCatalogRows(
        parsedRows,
        row => {
            const { external_id: _externalId, source_url: _sourceUrl, ...rules } = row;
            return JSON.stringify(rules);
        },
        true
    );
    const rows = catalog.rows;
    let stored = 0;
    for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const result = await db
            .insert(specialAbilities)
            .values(batch)
            .onConflictDoUpdate({
                target: specialAbilities.external_id,
                set: {
                    name: sql`excluded.name`,
                    category: sql`excluded.category`,
                    subcategory: sql`excluded.subcategory`,
                    description: sql`excluded.description`,
                    source_url: sql`excluded.source_url`,
                    ap_cost: sql`excluded.ap_cost`,
                    prerequisites: sql`excluded.prerequisites`,
                    requires_confirmation: sql`excluded.requires_confirmation`,
                    raw_properties: sql`excluded.raw_properties`,
                    updated_at: new Date(),
                },
            })
            .returning({ id: specialAbilities.id });
        stored += result.length;
    }
    return {
        parsed: parsedRows.length,
        accepted: rows.length,
        deduplicated: catalog.deduplicated,
        disambiguated: catalog.disambiguated,
        stored,
    };
}
