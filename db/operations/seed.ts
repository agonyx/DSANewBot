/**
 * In-process port of the seed-database Edge Function
 * (DSABackend/supabase/functions/seed-database). Idempotent — safe to re-run.
 * Canonical DSA 5e talent list plus the roadmap combat-maneuver catalog.
 */

import { inArray, sql } from 'drizzle-orm';
import { db } from '../index';
import { talents, actionModifications } from '../schema';

const TALENT_BASE: { name: string; stat1: string; stat2: string; stat3: string }[] = [
    { name: 'Alchemie', stat1: 'MU', stat2: 'KL', stat3: 'FF' },
    { name: 'Bekehren & Überzeugen', stat1: 'MU', stat2: 'KL', stat3: 'CH' },
    { name: 'Betören', stat1: 'MU', stat2: 'CH', stat3: 'CH' },
    { name: 'Boote & Schiffe', stat1: 'FF', stat2: 'GE', stat3: 'KK' },
    { name: 'Brett & Glücksspiel', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Einschüchtern', stat1: 'MU', stat2: 'IN', stat3: 'CH' },
    { name: 'Etikette', stat1: 'MU', stat2: 'IN', stat3: 'CH' },
    { name: 'Fährtensuchen', stat1: 'MU', stat2: 'IN', stat3: 'CH' },
    { name: 'Fahrzeuge', stat1: 'CH', stat2: 'FF', stat3: 'KO' },
    { name: 'Fesseln', stat1: 'KL', stat2: 'FF', stat3: 'KK' },
    { name: 'Fischen & Angeln', stat1: 'FF', stat2: 'GE', stat3: 'KO' },
    { name: 'Fliegen', stat1: 'MU', stat2: 'IN', stat3: 'GE' },
    { name: 'Gassenwissen', stat1: 'KL', stat2: 'IN', stat3: 'CH' },
    { name: 'Gaukeleien', stat1: 'MU', stat2: 'CH', stat3: 'FF' },
    { name: 'Geographie', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Geschichtswissen', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Götter & Kulte', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Handel', stat1: 'KL', stat2: 'IN', stat3: 'CH' },
    { name: 'Heilkunde: Gift', stat1: 'MU', stat2: 'KL', stat3: 'IN' },
    { name: 'Heilkunde: Krankheiten', stat1: 'MU', stat2: 'IN', stat3: 'KO' },
    { name: 'Heilkunde: Wunden', stat1: 'KL', stat2: 'FF', stat3: 'FF' },
    { name: 'Heilkunde: Seele', stat1: 'IN', stat2: 'CH', stat3: 'KO' },
    { name: 'Holzbearbeitung', stat1: 'FF', stat2: 'GE', stat3: 'KK' },
    { name: 'Klettern', stat1: 'MU', stat2: 'GE', stat3: 'KK' },
    { name: 'Körperbeherrschung', stat1: 'GE', stat2: 'GE', stat3: 'KO' },
    { name: 'Kraftakt', stat1: 'KO', stat2: 'KK', stat3: 'KK' },
    { name: 'Kriegskunst', stat1: 'MU', stat2: 'KL', stat3: 'IN' },
    { name: 'Lebensmittelbearbeitung', stat1: 'IN', stat2: 'FF', stat3: 'FF' },
    { name: 'Lederbearbeitung', stat1: 'FF', stat2: 'GE', stat3: 'KO' },
    { name: 'Magiekunde', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Malen & Zeichnen', stat1: 'IN', stat2: 'FF', stat3: 'FF' },
    { name: 'Mechanik', stat1: 'KL', stat2: 'KL', stat3: 'FF' },
    { name: 'Menschenkenntnis', stat1: 'KL', stat2: 'IN', stat3: 'CH' },
    { name: 'Metallbearbeitung', stat1: 'FF', stat2: 'KO', stat3: 'KK' },
    { name: 'Musizieren', stat1: 'CH', stat2: 'FF', stat3: 'KO' },
    { name: 'Orientierung', stat1: 'KL', stat2: 'IN', stat3: 'IN' },
    { name: 'Pflanzenkunde', stat1: 'KL', stat2: 'FF', stat3: 'KO' },
    { name: 'Rechnen', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Rechtskunde', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Reiten', stat1: 'CH', stat2: 'GE', stat3: 'KK' },
    { name: 'Sagen & Legenden', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Schlösserknacken', stat1: 'IN', stat2: 'FF', stat3: 'FF' },
    { name: 'Schwimmen', stat1: 'GE', stat2: 'KO', stat3: 'KK' },
    { name: 'Selbstbeherrschung', stat1: 'MU', stat2: 'MU', stat3: 'KO' },
    { name: 'Singen', stat1: 'KL', stat2: 'CH', stat3: 'KO' },
    { name: 'Sinnesschärfe', stat1: 'KL', stat2: 'IN', stat3: 'IN' },
    { name: 'Sphärenkunde', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Steinbearbeitung', stat1: 'FF', stat2: 'FF', stat3: 'KK' },
    { name: 'Sternkunde', stat1: 'KL', stat2: 'KL', stat3: 'IN' },
    { name: 'Stoffbearbeitung', stat1: 'KL', stat2: 'FF', stat3: 'FF' },
    { name: 'Tanzen', stat1: 'KL', stat2: 'CH', stat3: 'GE' },
    { name: 'Taschendiebstahl', stat1: 'MU', stat2: 'FF', stat3: 'GE' },
    { name: 'Tierkunde', stat1: 'MU', stat2: 'MU', stat3: 'CH' },
    { name: 'Überreden', stat1: 'MU', stat2: 'IN', stat3: 'CH' },
    { name: 'Verbergen', stat1: 'MU', stat2: 'IN', stat3: 'GE' },
    { name: 'Verkleiden', stat1: 'IN', stat2: 'CH', stat3: 'GE' },
    { name: 'Wildnisleben', stat1: 'MU', stat2: 'GE', stat3: 'KO' },
    { name: 'Willenskraft', stat1: 'MU', stat2: 'IN', stat3: 'CH' },
    { name: 'Zechen', stat1: 'KL', stat2: 'KO', stat3: 'KK' },
];

type TalentRule = { category: string; factor: 'A' | 'B' | 'C' | 'D'; encumbered: boolean };

const TALENT_RULES: Record<string, TalentRule> = {
    Alchemie: { category: 'Handwerk', factor: 'C', encumbered: true },
    'Bekehren & Überzeugen': { category: 'Gesellschaft', factor: 'B', encumbered: false },
    Betören: { category: 'Gesellschaft', factor: 'B', encumbered: false },
    'Boote & Schiffe': { category: 'Handwerk', factor: 'B', encumbered: true },
    'Brett & Glücksspiel': { category: 'Wissen', factor: 'A', encumbered: false },
    Einschüchtern: { category: 'Gesellschaft', factor: 'B', encumbered: false },
    Etikette: { category: 'Gesellschaft', factor: 'B', encumbered: false },
    Fährtensuchen: { category: 'Natur', factor: 'C', encumbered: true },
    Fahrzeuge: { category: 'Handwerk', factor: 'A', encumbered: true },
    Fesseln: { category: 'Handwerk', factor: 'A', encumbered: false },
    'Fischen & Angeln': { category: 'Natur', factor: 'A', encumbered: true },
    Fliegen: { category: 'Körper', factor: 'B', encumbered: true },
    Gassenwissen: { category: 'Gesellschaft', factor: 'C', encumbered: false },
    Gaukeleien: { category: 'Körper', factor: 'A', encumbered: true },
    Geographie: { category: 'Wissen', factor: 'B', encumbered: false },
    Geschichtswissen: { category: 'Wissen', factor: 'B', encumbered: false },
    'Götter & Kulte': { category: 'Wissen', factor: 'B', encumbered: false },
    Handel: { category: 'Gesellschaft', factor: 'B', encumbered: false },
    'Heilkunde: Gift': { category: 'Wissen', factor: 'B', encumbered: true },
    'Heilkunde: Krankheiten': { category: 'Wissen', factor: 'B', encumbered: true },
    'Heilkunde: Seele': { category: 'Wissen', factor: 'B', encumbered: false },
    'Heilkunde: Wunden': { category: 'Wissen', factor: 'D', encumbered: true },
    Holzbearbeitung: { category: 'Handwerk', factor: 'B', encumbered: true },
    Klettern: { category: 'Körper', factor: 'B', encumbered: true },
    Körperbeherrschung: { category: 'Körper', factor: 'D', encumbered: true },
    Kraftakt: { category: 'Körper', factor: 'B', encumbered: true },
    Kriegskunst: { category: 'Wissen', factor: 'B', encumbered: false },
    Lebensmittelbearbeitung: { category: 'Handwerk', factor: 'A', encumbered: true },
    Lederbearbeitung: { category: 'Handwerk', factor: 'B', encumbered: true },
    Magiekunde: { category: 'Wissen', factor: 'C', encumbered: false },
    'Malen & Zeichnen': { category: 'Handwerk', factor: 'A', encumbered: true },
    Mechanik: { category: 'Wissen', factor: 'B', encumbered: false },
    Menschenkenntnis: { category: 'Gesellschaft', factor: 'C', encumbered: false },
    Metallbearbeitung: { category: 'Handwerk', factor: 'C', encumbered: true },
    Musizieren: { category: 'Handwerk', factor: 'A', encumbered: true },
    Orientierung: { category: 'Natur', factor: 'B', encumbered: false },
    Pflanzenkunde: { category: 'Natur', factor: 'C', encumbered: true },
    Rechnen: { category: 'Wissen', factor: 'A', encumbered: false },
    Rechtskunde: { category: 'Wissen', factor: 'A', encumbered: false },
    Reiten: { category: 'Körper', factor: 'B', encumbered: true },
    'Sagen & Legenden': { category: 'Wissen', factor: 'B', encumbered: false },
    Schlösserknacken: { category: 'Handwerk', factor: 'C', encumbered: true },
    Schwimmen: { category: 'Körper', factor: 'B', encumbered: true },
    Selbstbeherrschung: { category: 'Körper', factor: 'D', encumbered: false },
    Singen: { category: 'Handwerk', factor: 'A', encumbered: false },
    Sinnesschärfe: { category: 'Körper', factor: 'D', encumbered: false },
    Sphärenkunde: { category: 'Wissen', factor: 'B', encumbered: false },
    Steinbearbeitung: { category: 'Handwerk', factor: 'A', encumbered: true },
    Sternkunde: { category: 'Wissen', factor: 'A', encumbered: false },
    Stoffbearbeitung: { category: 'Handwerk', factor: 'A', encumbered: true },
    Tanzen: { category: 'Körper', factor: 'A', encumbered: true },
    Taschendiebstahl: { category: 'Gesellschaft', factor: 'B', encumbered: true },
    Tierkunde: { category: 'Natur', factor: 'C', encumbered: true },
    Überreden: { category: 'Gesellschaft', factor: 'C', encumbered: false },
    Verbergen: { category: 'Körper', factor: 'C', encumbered: true },
    Verkleiden: { category: 'Gesellschaft', factor: 'B', encumbered: true },
    Wildnisleben: { category: 'Natur', factor: 'C', encumbered: true },
    Willenskraft: { category: 'Körper', factor: 'D', encumbered: false },
    Zechen: { category: 'Körper', factor: 'A', encumbered: false },
};

export const TALENTS = TALENT_BASE.map(talent => {
    const rule = TALENT_RULES[talent.name];
    if (!rule) throw new Error(`Missing advancement rules for talent ${talent.name}`);
    return {
        ...talent,
        category: rule.category,
        advancement_factor: rule.factor,
        affected_by_encumbrance: rule.encumbered,
    };
});

const ACTION_MODIFICATION_BASE = [
    {
        name: 'Wuchtschlag',
        description: 'Erschwert die AT, um den Schaden zu erhöhen.',
        action_type: 'MELEE' as const,
        prerequisites: {
            techniques: [
                'Hiebwaffen',
                'Kettenwaffen',
                'Raufen',
                'Schwerter',
                'Stangenwaffen',
                'Zweihandhiebwaffen',
                'Zweihandschwerter',
            ],
            kk: 13,
        },
        rules: { type: 'power_attack', at_modifier: -2, damage_bonus: 2 },
    },
    {
        name: 'Finte',
        description: 'Erschwert die AT, um die PA des Gegners zu erschweren.',
        action_type: 'MELEE' as const,
        prerequisites: {
            techniques: [
                'Dolche',
                'Fächer',
                'Fechtwaffen',
                'Hiebwaffen',
                'Peitschen',
                'Raufen',
                'Schwerter',
                'Stangenwaffen',
                'Zweihandhiebwaffen',
                'Zweihandschwerter',
            ],
            ge: 13,
        },
        rules: { type: 'feint', at_modifier: -1, opponent_pa_modifier: -2 },
    },
    {
        name: 'Präziser Stich',
        description: 'Erschwert die AT mit leichten Waffen, um den Schaden zu erhöhen.',
        action_type: 'MELEE' as const,
        prerequisites: { ge: 13, techniques: ['Dolche', 'Fächer', 'Fechtwaffen'] },
        rules: { type: 'precise_thrust', at_modifier: -2, damage_bonus: 2, ap_cost: 15 },
    },
    {
        name: 'Entwaffnen',
        description: 'Zwingt das Ziel bei einem Treffer, die geführte Waffe fallen zu lassen.',
        action_type: 'MELEE' as const,
        prerequisites: { ge: 15 },
        rules: { type: 'disarm', at_modifier: -4, ap_cost: 40 },
    },
    {
        name: 'Zu Fall bringen',
        description: 'Bringt ein geeignetes Ziel bei einem Treffer zu Fall.',
        action_type: 'MELEE' as const,
        prerequisites: { kk: 13, techniques: ['Peitschen', 'Stangenwaffen'] },
        rules: { type: 'trip', at_modifier: -4, damage_die: '1w3', ap_cost: 8 },
    },
    {
        name: 'Haltegriff',
        description: 'Fixiert und beengt ein gleich großes oder kleineres Ziel.',
        action_type: 'MELEE' as const,
        prerequisites: { technique: 'Raufen', hands_free: 2 },
        rules: { type: 'grapple', at_modifier: 0, ap_cost: 0 },
    },
    {
        name: 'Gezielter Angriff',
        description: 'Halbiert die Trefferzonenerschwernis eines Nahkampfangriffs.',
        action_type: 'MELEE' as const,
        prerequisites: { ge: 13 },
        rules: { type: 'called_shot', ap_cost: 10 },
    },
    {
        name: 'Gezielter Schuss',
        description: 'Halbiert die Trefferzonenerschwernis eines Fernkampfangriffs.',
        action_type: 'RANGED' as const,
        prerequisites: { ff: 13 },
        rules: { type: 'called_shot', ap_cost: 10 },
    },
    {
        name: 'Sturmangriff',
        description: 'Angriff nach mindestens vier Schritt Anlauf; ein Fehlschlag gewährt einen Passierschlag.',
        action_type: 'MELEE' as const,
        prerequisites: { mu: 13, movement_speed: 4, requires: 'Wuchtschlag' },
        rules: { type: 'charge', at_modifier: -2, ap_cost: 25 },
    },
    {
        name: 'Verteidigungshaltung',
        description: 'Verzichtet auf Aktionen für +4 PA bis zum nächsten eigenen Zug.',
        action_type: 'MELEE' as const,
        prerequisites: { in: 13 },
        rules: { type: 'full_defense', pa_modifier: 4, ap_cost: 10 },
    },
    {
        name: 'Meisterparade',
        description: 'Weitere Paraden in derselben Kampfrunde erhalten -2 statt -3.',
        action_type: 'MELEE' as const,
        prerequisites: { ge_or_kk: 15 },
        rules: { type: 'masterful_parry', defense_penalty_step: 2, ap_cost: 25 },
    },
    {
        name: 'Beidhändiger Kampf I',
        description: 'Reduziert den Grundabzug für Angriffe mit zwei Waffen auf -1 AT/PA.',
        action_type: 'MELEE' as const,
        prerequisites: { ge: 13 },
        rules: { type: 'two_weapon_training', two_weapon_penalty: -1, ap_cost: 20 },
    },
    {
        name: 'Beidhändiger Kampf II',
        description: 'Entfernt den Grundabzug für Angriffe mit zwei Waffen.',
        action_type: 'MELEE' as const,
        prerequisites: { ge: 15, requires: 'Beidhändiger Kampf I' },
        rules: { type: 'two_weapon_training', two_weapon_penalty: 0, ap_cost: 35 },
    },
    {
        name: 'Präziser Schuss',
        description: 'Erschwert den Fernkampfangriff, um Deckung teilweise zu überwinden.',
        action_type: 'RANGED' as const,
        prerequisites: { ff: 13 },
        rules: { type: 'precise_shot', at_modifier: -2, damage_bonus: 1, ap_cost: 15 },
    },
];

const ACTION_MODIFICATION_COSTS: Record<string, number> = {
    Wuchtschlag: 15,
    Finte: 15,
    'Präziser Stich': 15,
    Entwaffnen: 40,
    'Zu Fall bringen': 20,
    Haltegriff: 5,
    'Gezielter Angriff': 10,
    'Gezielter Schuss': 10,
    Sturmangriff: 25,
    Verteidigungshaltung: 10,
    Meisterparade: 25,
    'Beidhändiger Kampf I': 20,
    'Beidhändiger Kampf II': 35,
    'Präziser Schuss': 15,
};

export const ACTION_MODIFICATIONS = ACTION_MODIFICATION_BASE.map(modification => {
    const apCost = ACTION_MODIFICATION_COSTS[modification.name];
    return { ...modification, rules: { ...modification.rules, ap_cost: apCost }, ap_cost: apCost };
});

export interface SeedResult {
    success: true;
    results: {
        talents: { inserted: number; skipped: number };
        action_modifications: { inserted: number; skipped: number };
    };
}

/** Seed the talent and action_modification catalogs. Idempotent via unique name constraints. */
export async function seedDatabase(): Promise<SeedResult> {
    const [knownTalents, knownMods] = await Promise.all([
        db
            .select({ name: talents.name })
            .from(talents)
            .where(
                inArray(
                    talents.name,
                    TALENTS.map(row => row.name)
                )
            ),
        db
            .select({ name: actionModifications.name })
            .from(actionModifications)
            .where(
                inArray(
                    actionModifications.name,
                    ACTION_MODIFICATIONS.map(row => row.name)
                )
            ),
    ]);
    const knownTalentNames = new Set(knownTalents.map(row => row.name));
    const knownModNames = new Set(knownMods.map(row => row.name));

    await db
        .insert(talents)
        .values(TALENTS)
        .onConflictDoUpdate({
            target: talents.name,
            set: {
                stat1: sql`excluded.stat1`,
                stat2: sql`excluded.stat2`,
                stat3: sql`excluded.stat3`,
                category: sql`excluded.category`,
                advancement_factor: sql`excluded.advancement_factor`,
                affected_by_encumbrance: sql`excluded.affected_by_encumbrance`,
            },
        })
        .returning({ id: talents.id });

    await db
        .insert(actionModifications)
        .values(ACTION_MODIFICATIONS)
        .onConflictDoUpdate({
            target: actionModifications.name,
            set: {
                description: sql`excluded.description`,
                action_type: sql`excluded.action_type`,
                prerequisites: sql`excluded.prerequisites`,
                rules: sql`excluded.rules`,
                ap_cost: sql`excluded.ap_cost`,
            },
        })
        .returning({ id: actionModifications.id });

    return {
        success: true,
        results: {
            talents: {
                inserted: TALENTS.length - knownTalentNames.size,
                skipped: knownTalentNames.size,
            },
            action_modifications: {
                inserted: ACTION_MODIFICATIONS.length - knownModNames.size,
                skipped: knownModNames.size,
            },
        },
    };
}
