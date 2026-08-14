import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { equipmentCatalog } from '../db/schema';

interface SourceEntry {
    id: string;
    name: string;
    url?: string;
    description?: string;
    properties?: Record<string, string>;
}

type CatalogSeed = Omit<typeof equipmentCatalog.$inferInsert, 'id' | 'external_id' | 'created_at' | 'updated_at'> & {
    sourceName: string;
};

const DATA_ROOT = path.resolve(__dirname, '../DSA5WikiScraper/dsa_scraper_v3/data/json');

const CATALOG: CatalogSeed[] = [
    {
        sourceName: 'Langschwert',
        name: 'Langschwert',
        category: 'WEAPON',
        subcategory: 'Schwerter',
        price_kreuzer: 20_000,
        weight_grams: 1_000,
        weapon_type: 'MELEE',
        combat_technique: 'Schwerter',
        tp: '1w6+4',
    },
    {
        sourceName: 'Dolch',
        name: 'Dolch',
        category: 'WEAPON',
        subcategory: 'Dolche',
        price_kreuzer: 4_500,
        weight_grams: 500,
        weapon_type: 'MELEE',
        combat_technique: 'Dolche',
        tp: '1w6+1',
        pa_modifier: -1,
    },
    {
        sourceName: 'Kurzbogen',
        name: 'Kurzbogen',
        category: 'WEAPON',
        subcategory: 'Bögen',
        price_kreuzer: 8_000,
        weight_grams: 500,
        weapon_type: 'RANGED',
        combat_technique: 'Bögen',
        tp: '1w6+4',
        range_close: 10,
        range_medium: 50,
        range_far: 80,
        reload_actions: 1,
        is_two_handed: true,
    },
    {
        sourceName: 'Holzschild',
        name: 'Holzschild',
        category: 'SHIELD',
        subcategory: 'Schilde',
        price_kreuzer: 5_000,
        weight_grams: 3_500,
        weapon_type: 'MELEE',
        combat_technique: 'Schilde',
        tp: '1w6',
        at_modifier: -4,
        shield_pa_bonus: 1,
    },
    {
        sourceName: 'Buckler',
        name: 'Buckler',
        category: 'SHIELD',
        subcategory: 'Schilde',
        price_kreuzer: 3_000,
        weight_grams: 1_500,
        weapon_type: 'MELEE',
        combat_technique: 'Schilde',
        tp: '1w6',
        at_modifier: -3,
        shield_pa_bonus: 1,
    },
    {
        sourceName: 'Schwere Kleidung/Winterkleidung',
        name: 'Schwere Kleidung',
        category: 'CLOTHING',
        subcategory: 'Kleidung',
        price_kreuzer: 2_000,
        weight_grams: 2_000,
        default_slot: 'BODY',
        armor_rs: 1,
    },
    {
        sourceName: 'Stoffrüstung',
        name: 'Stoffrüstung',
        category: 'ARMOR',
        subcategory: 'Rüstung',
        price_kreuzer: 7_500,
        weight_grams: 3_000,
        default_slot: 'BODY',
        armor_rs: 2,
        armor_be: 1,
    },
    {
        sourceName: 'Lederrüstung',
        name: 'Lederrüstung',
        category: 'ARMOR',
        subcategory: 'Rüstung',
        price_kreuzer: 15_000,
        weight_grams: 5_000,
        default_slot: 'BODY',
        armor_rs: 3,
        armor_be: 1,
    },
    {
        sourceName: 'Kettenrüstung',
        name: 'Kettenrüstung',
        category: 'ARMOR',
        subcategory: 'Rüstung',
        price_kreuzer: 50_000,
        weight_grams: 10_000,
        default_slot: 'BODY',
        armor_rs: 4,
        armor_be: 2,
    },
    {
        sourceName: 'Schuppenrüstung',
        name: 'Schuppenrüstung',
        category: 'ARMOR',
        subcategory: 'Rüstung',
        price_kreuzer: 75_000,
        weight_grams: 12_000,
        default_slot: 'BODY',
        armor_rs: 5,
        armor_be: 3,
    },
    {
        sourceName: 'Plattenrüstung',
        name: 'Plattenrüstung',
        category: 'ARMOR',
        subcategory: 'Rüstung',
        price_kreuzer: 250_000,
        weight_grams: 25_000,
        default_slot: 'BODY',
        armor_rs: 6,
        armor_be: 4,
    },
    {
        sourceName: 'Helm',
        name: 'Helm',
        category: 'ARMOR',
        subcategory: 'Helme',
        price_kreuzer: 5_000,
        weight_grams: 2_000,
        default_slot: 'HEAD',
        armor_rs: 1,
        armor_be: 1,
    },
    {
        sourceName: 'Lederrucksack',
        name: 'Lederrucksack',
        category: 'GEAR',
        subcategory: 'Reiseausrüstung',
        price_kreuzer: 2_000,
        weight_grams: 500,
        default_slot: 'BACK',
    },
    {
        sourceName: 'Fackel',
        name: 'Fackel',
        category: 'GEAR',
        subcategory: 'Lichtquellen',
        price_kreuzer: 50,
        weight_grams: 500,
    },
    {
        sourceName: 'Fesselseil',
        name: 'Seil (10 Schritt)',
        category: 'GEAR',
        subcategory: 'Reiseausrüstung',
        price_kreuzer: 1_000,
        weight_grams: 4_000,
    },
    {
        sourceName: 'Schlafsack',
        name: 'Schlafsack',
        category: 'GEAR',
        subcategory: 'Reiseausrüstung',
        price_kreuzer: 2_500,
        weight_grams: 2_000,
    },
    {
        sourceName: 'Proviant',
        name: 'Proviant (1 Tag)',
        category: 'CONSUMABLE',
        subcategory: 'Nahrung',
        price_kreuzer: 50,
        weight_grams: 500,
    },
    {
        sourceName: 'Umhang',
        name: 'Umhang',
        category: 'CLOTHING',
        subcategory: 'Kleidung',
        price_kreuzer: 1_500,
        weight_grams: 1_000,
        default_slot: 'BACK',
    },
    {
        sourceName: 'Handschuhe',
        name: 'Handschuhe',
        category: 'CLOTHING',
        subcategory: 'Kleidung',
        price_kreuzer: 500,
        weight_grams: 200,
        default_slot: 'HANDS',
    },
    {
        sourceName: 'Stiefel',
        name: 'Stiefel',
        category: 'CLOTHING',
        subcategory: 'Kleidung',
        price_kreuzer: 1_000,
        weight_grams: 1_000,
        default_slot: 'FEET',
    },
];

async function loadSources(): Promise<SourceEntry[]> {
    const files = ['ruestkammer_weapons.json', 'ruestkammer_equipment.json', 'ruestkammer_armor.json'];
    const rows = await Promise.all(
        files.map(async file => JSON.parse(await readFile(path.join(DATA_ROOT, file), 'utf8')) as SourceEntry[])
    );
    return rows.flat();
}

function sourceFor(entries: SourceEntry[], requested: string) {
    const normalized = requested.toLocaleLowerCase('de-DE');
    return (
        entries.find(entry => entry.name.toLocaleLowerCase('de-DE') === normalized) ??
        entries.find(entry => entry.name.toLocaleLowerCase('de-DE').includes(normalized))
    );
}

export async function seedEquipmentCatalog() {
    const sources = await loadSources();
    const rows = CATALOG.map(({ sourceName, ...mechanics }) => {
        const source = sourceFor(sources, sourceName);
        return {
            ...mechanics,
            external_id:
                source?.id ?? `curated_equipment_${mechanics.name.toLocaleLowerCase('de-DE').replace(/\W+/gu, '_')}`,
            description: source?.description || mechanics.description || null,
            source_url: source?.url ?? null,
            raw_properties: {
                ...(source?.properties ?? {}),
                catalogPolicy: 'Curated DSA 5 core mechanics; local Regelwiki text supplies provenance.',
            },
        };
    });
    const stored = await db
        .insert(equipmentCatalog)
        .values(rows)
        .onConflictDoUpdate({
            target: equipmentCatalog.external_id,
            set: {
                name: sql`excluded.name`,
                category: sql`excluded.category`,
                subcategory: sql`excluded.subcategory`,
                description: sql`excluded.description`,
                source_url: sql`excluded.source_url`,
                price_kreuzer: sql`excluded.price_kreuzer`,
                weight_grams: sql`excluded.weight_grams`,
                default_slot: sql`excluded.default_slot`,
                armor_rs: sql`excluded.armor_rs`,
                armor_be: sql`excluded.armor_be`,
                shield_pa_bonus: sql`excluded.shield_pa_bonus`,
                weapon_type: sql`excluded.weapon_type`,
                combat_technique: sql`excluded.combat_technique`,
                tp: sql`excluded.tp`,
                at_modifier: sql`excluded.at_modifier`,
                pa_modifier: sql`excluded.pa_modifier`,
                range_close: sql`excluded.range_close`,
                range_medium: sql`excluded.range_medium`,
                range_far: sql`excluded.range_far`,
                reload_actions: sql`excluded.reload_actions`,
                is_two_handed: sql`excluded.is_two_handed`,
                raw_properties: sql`excluded.raw_properties`,
                updated_at: new Date(),
            },
        })
        .returning({ id: equipmentCatalog.id });
    return { sourceEntries: sources.length, curatedEntries: rows.length, stored: stored.length };
}
