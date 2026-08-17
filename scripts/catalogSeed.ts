import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { liturgies, spells } from '../db/schema';
import { canonicalizeCatalogRows } from '../utils/catalogSeedUtils';
import { parseCatalogAbility, type RegelwikiAbility } from '../utils/supernaturalCatalogUtils';

const DATA_ROOT = path.resolve(__dirname, '../DSA5WikiScraper/dsa_scraper_v3/data/json');

async function loadSource(fileName: string): Promise<RegelwikiAbility[]> {
    const raw = await readFile(path.join(DATA_ROOT, fileName), 'utf8');
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error(`${fileName} must contain a JSON array`);
    return value as RegelwikiAbility[];
}

function chunks<T>(rows: T[], size = 100): T[][] {
    const result: T[][] = [];
    for (let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
    return result;
}

export async function seedSupernaturalCatalogs() {
    const [magicSource, karmaSource] = await Promise.all([loadSource('magic.json'), loadSource('götterwirken.json')]);
    const parsedMagicRows = magicSource
        .map(entry => parseCatalogAbility(entry, 'MAGIC'))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map(({ aspects: _aspects, ...entry }) => entry);
    const parsedKarmaRows = karmaSource
        .map(entry => parseCatalogAbility(entry, 'KARMA'))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map(({ feature: _feature, ...entry }) => entry);
    const catalogSignature = <T extends { external_id: string; source_url: string | null }>(row: T) => {
        const { external_id: _externalId, source_url: _sourceUrl, ...rules } = row;
        return JSON.stringify(rules);
    };
    const magicCatalog = canonicalizeCatalogRows(parsedMagicRows, catalogSignature);
    const karmaCatalog = canonicalizeCatalogRows(parsedKarmaRows, catalogSignature);
    const magicRows = magicCatalog.rows;
    const karmaRows = karmaCatalog.rows;

    let spellCount = 0;
    for (const batch of chunks(magicRows)) {
        const stored = await db
            .insert(spells)
            .values(batch)
            .onConflictDoUpdate({
                target: spells.external_id,
                set: {
                    name: sql`excluded.name`,
                    kind: sql`excluded.kind`,
                    probe_attr1: sql`excluded.probe_attr1`,
                    probe_attr2: sql`excluded.probe_attr2`,
                    probe_attr3: sql`excluded.probe_attr3`,
                    traditions: sql`excluded.traditions`,
                    feature: sql`excluded.feature`,
                    resource_cost: sql`excluded.resource_cost`,
                    permanent_cost: sql`excluded.permanent_cost`,
                    casting_time: sql`excluded.casting_time`,
                    casting_time_actions: sql`excluded.casting_time_actions`,
                    casting_time_minutes: sql`excluded.casting_time_minutes`,
                    range: sql`excluded.range`,
                    duration: sql`excluded.duration`,
                    target_category: sql`excluded.target_category`,
                    advancement_factor: sql`excluded.advancement_factor`,
                    ap_cost: sql`excluded.ap_cost`,
                    description: sql`excluded.description`,
                    source_url: sql`excluded.source_url`,
                    effect_type: sql`excluded.effect_type`,
                    effect_data: sql`excluded.effect_data`,
                    raw_properties: sql`excluded.raw_properties`,
                    updated_at: new Date(),
                },
            })
            .returning({ id: spells.id });
        spellCount += stored.length;
    }

    let liturgyCount = 0;
    for (const batch of chunks(karmaRows)) {
        const stored = await db
            .insert(liturgies)
            .values(batch)
            .onConflictDoUpdate({
                target: liturgies.external_id,
                set: {
                    name: sql`excluded.name`,
                    kind: sql`excluded.kind`,
                    probe_attr1: sql`excluded.probe_attr1`,
                    probe_attr2: sql`excluded.probe_attr2`,
                    probe_attr3: sql`excluded.probe_attr3`,
                    traditions: sql`excluded.traditions`,
                    aspects: sql`excluded.aspects`,
                    resource_cost: sql`excluded.resource_cost`,
                    permanent_cost: sql`excluded.permanent_cost`,
                    casting_time: sql`excluded.casting_time`,
                    casting_time_actions: sql`excluded.casting_time_actions`,
                    casting_time_minutes: sql`excluded.casting_time_minutes`,
                    range: sql`excluded.range`,
                    duration: sql`excluded.duration`,
                    target_category: sql`excluded.target_category`,
                    advancement_factor: sql`excluded.advancement_factor`,
                    ap_cost: sql`excluded.ap_cost`,
                    description: sql`excluded.description`,
                    source_url: sql`excluded.source_url`,
                    effect_type: sql`excluded.effect_type`,
                    effect_data: sql`excluded.effect_data`,
                    raw_properties: sql`excluded.raw_properties`,
                    updated_at: new Date(),
                },
            })
            .returning({ id: liturgies.id });
        liturgyCount += stored.length;
    }

    return {
        spells: {
            source: magicSource.length,
            parsed: parsedMagicRows.length,
            accepted: magicRows.length,
            deduplicated: magicCatalog.deduplicated,
            stored: spellCount,
        },
        liturgies: {
            source: karmaSource.length,
            parsed: parsedKarmaRows.length,
            accepted: karmaRows.length,
            deduplicated: karmaCatalog.deduplicated,
            stored: liturgyCount,
        },
    };
}
