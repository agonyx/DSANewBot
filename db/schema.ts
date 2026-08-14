/**
 * Drizzle schema for DSANewBot — single source of truth for the data model.
 *
 * Mirrors the live Supabase/Postgres schema. Property names are kept in
 * snake_case on purpose so they match the column names and the existing bot
 * code (which reads rows by snake_case key, e.g. `stats.le_max`,
 * `resourceType.currentCol === 'asp_current'`). This keeps the Phase 3 call-site
 * rewrite a near 1:1 swap and lets `utils/transforms.js` keep working unchanged.
 *
 * Source references:
 *  - Enums + CASCADE rules: DSABackend/AGENTS.md (lines ~132-154)
 *  - rules tables DDL:      DSANewBot/RULES_VECTOR_DB.md (lines ~88-294)
 *  - Column inference:      commands/*, handlers/*, utils/* (see migration plan)
 *
 * NOTE: This is the reconstructed schema (fallback branch). If a `pg_dump
 * --schema-only` from the live Supabase project becomes available, diff this
 * file against it before applying.
 */

import { sql } from 'drizzle-orm';
import {
    boolean,
    customType,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums (verbatim from DSABackend/AGENTS.md)
// ---------------------------------------------------------------------------

export const selectedEnum = pgEnum('selected_enum', ['NO', 'YES']);
export const combatStateEnum = pgEnum('combat_state', ['SETUP', 'RUNNING', 'PAUSED', 'ENDED']);
export const combatantTypeEnum = pgEnum('combatant_type', ['PLAYER', 'NPC']);
export const combatantAllegianceEnum = pgEnum('combatant_allegiance', ['PLAYER_SIDE', 'HOSTILE']);
export const weaponTypeEnum = pgEnum('weapon_type', ['MELEE', 'RANGED']);
export const equippedStatusEnum = pgEnum('equipped_status', ['Y', 'N']);
export const equippedSlotEnum = pgEnum('equipped_slot', ['ADAPTIVE', 'OFFENSE', 'DEFENSE']);
export const actionTypeEnum = pgEnum('action_type', ['MELEE', 'RANGED', 'MAGIC']);

// Item type is referenced in code as a free-form string enum (POTION/FOOD/...).
// Kept as text rather than a DB enum so the catalog stays open-ended.
// Weapon/item/category fields below follow the same convention.

// ---------------------------------------------------------------------------
// pgvector custom type — vector(N). Requires `CREATE EXTENSION vector`.
// ---------------------------------------------------------------------------

export const vector = customType<{ data: string; driverData: string; config: { length: number } }>({
    dataType(config) {
        return `vector(${config?.length ?? 1536})`;
    },
});

// ---------------------------------------------------------------------------
// Core character tables
// ---------------------------------------------------------------------------

export const players = pgTable('players', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    discord_id: text().notNull(),
    selected: selectedEnum().default('NO').notNull(),
    avatar: text(),
});

export const stats = pgTable('stats', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    // 8 DSA attributes. `in` is a SQL keyword; Drizzle quotes it as "in".
    mu: integer().default(0).notNull(),
    kl: integer().default(0).notNull(),
    in: integer().default(0).notNull(),
    ch: integer().default(0).notNull(),
    ff: integer().default(0).notNull(),
    ge: integer().default(0).notNull(),
    ko: integer().default(0).notNull(),
    kk: integer().default(0).notNull(),
    le_max: integer().default(0).notNull(),
    le_current: integer().default(0).notNull(),
    wounds: integer().default(0).notNull(),
    wound_threshold_modifier: integer().default(0).notNull(),
    pending_healing_bonus: integer().default(0).notNull(),
    pain_suppression: integer().default(0).notNull(),
    pain_suppression_phases: integer().default(0).notNull(),
    pain_modifier: integer().default(0).notNull(),
    stabilization_failures: integer().default(0).notNull(),
    asp_max: integer().default(0).notNull(),
    asp_current: integer().default(0).notNull(),
    kap_max: integer().default(0).notNull(),
    kap_current: integer().default(0).notNull(),
    schicksalspunkte_max: integer().default(0).notNull(),
    schicksalspunkte_current: integer().default(0).notNull(),
    initiative: integer().default(0).notNull(),
    natural_armor: integer().default(0).notNull(),
    ruestungsschutz: integer().default(0).notNull(),
    belastung: integer().default(0).notNull(),
    ausweichen: integer().default(0).notNull(),
    attacke_basis: integer().default(0).notNull(),
    parade_basis: integer().default(0).notNull(),
    ap_total: integer().default(0).notNull(),
    ap_available: integer().default(0).notNull(),
    ap_spent: integer().default(0).notNull(),
});

export const diceMacros = pgTable(
    'dice_macros',
    {
        id: uuid().primaryKey().defaultRandom(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        name: text().notNull(),
        notation: text().notNull(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    table => [unique('dice_macros_player_id_name_key').on(table.player_id, table.name)]
);

export const talents = pgTable('talents', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull().unique(),
    stat1: text().notNull(),
    stat2: text().notNull(),
    stat3: text().notNull(),
    category: text().default('UNKNOWN').notNull(),
    advancement_factor: text().default('B').notNull(),
    affected_by_encumbrance: boolean().default(true).notNull(),
});

export const playerTalents = pgTable(
    'player_talents',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        talent_id: integer()
            .notNull()
            .references(() => talents.id, { onDelete: 'cascade' }),
        ftw: integer().default(0).notNull(),
    },
    t => [unique('player_talents_player_id_talent_id_key').on(t.player_id, t.talent_id)]
);

export const actionModifications = pgTable('action_modifications', {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull().unique(),
    description: text(),
    action_type: actionTypeEnum(),
    prerequisites: jsonb(),
    rules: jsonb(),
    ap_cost: integer().default(0).notNull(),
});

export const playerActionModifications = pgTable(
    'player_action_modifications',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        action_modification_id: uuid()
            .notNull()
            .references(() => actionModifications.id, { onDelete: 'cascade' }),
        ftw: integer().default(0).notNull(),
    },
    t => [
        unique('player_action_modifications_player_id_action_modification_id_key').on(
            t.player_id,
            t.action_modification_id
        ),
    ]
);

/** Source-backed non-combat magical and karmic special abilities. */
export const specialAbilities = pgTable('special_abilities', {
    id: uuid().primaryKey().defaultRandom(),
    external_id: text().notNull().unique(),
    name: text().notNull(),
    category: text().notNull(), // MAGICAL | KARMAL
    subcategory: text(),
    description: text(),
    source_url: text(),
    ap_cost: integer().notNull(),
    prerequisites: text(),
    requires_confirmation: boolean().default(false).notNull(),
    raw_properties: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const playerSpecialAbilities = pgTable(
    'player_special_abilities',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        special_ability_id: uuid()
            .notNull()
            .references(() => specialAbilities.id, { onDelete: 'cascade' }),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('player_special_abilities_player_id_special_ability_id_key').on(t.player_id, t.special_ability_id)]
);

export const supernaturalProfiles = pgTable('supernatural_profiles', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    player_id: integer()
        .notNull()
        .unique()
        .references(() => players.id, { onDelete: 'cascade' }),
    magical_tradition: text(),
    blessed_tradition: text(),
    deity: text(),
    favored_talents: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const spells = pgTable('spells', {
    id: uuid().primaryKey().defaultRandom(),
    external_id: text().notNull().unique(),
    name: text().notNull(),
    kind: text().notNull(), // SPELL | RITUAL | TRICK
    probe_attr1: text(),
    probe_attr2: text(),
    probe_attr3: text(),
    traditions: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    feature: text(),
    resource_cost: integer().default(0).notNull(),
    permanent_cost: integer().default(0).notNull(),
    casting_time: text(),
    casting_time_actions: integer().default(0).notNull(),
    casting_time_minutes: integer().default(0).notNull(),
    range: text(),
    duration: text(),
    target_category: text(),
    advancement_factor: text(),
    ap_cost: integer().default(1).notNull(),
    description: text(),
    source_url: text(),
    effect_type: text().default('UTILITY').notNull(),
    effect_data: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    raw_properties: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const playerSpells = pgTable(
    'player_spells',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        spell_id: uuid()
            .notNull()
            .references(() => spells.id, { onDelete: 'cascade' }),
        ftw: integer().default(0).notNull(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('player_spells_player_id_spell_id_key').on(t.player_id, t.spell_id)]
);

export const liturgies = pgTable('liturgies', {
    id: uuid().primaryKey().defaultRandom(),
    external_id: text().notNull().unique(),
    name: text().notNull(),
    kind: text().notNull(), // LITURGY | CEREMONY | BLESSING
    probe_attr1: text(),
    probe_attr2: text(),
    probe_attr3: text(),
    traditions: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    aspects: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    resource_cost: integer().default(0).notNull(),
    permanent_cost: integer().default(0).notNull(),
    casting_time: text(),
    casting_time_actions: integer().default(0).notNull(),
    casting_time_minutes: integer().default(0).notNull(),
    range: text(),
    duration: text(),
    target_category: text(),
    advancement_factor: text(),
    ap_cost: integer().default(1).notNull(),
    description: text(),
    source_url: text(),
    effect_type: text().default('UTILITY').notNull(),
    effect_data: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    raw_properties: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const playerLiturgies = pgTable(
    'player_liturgies',
    {
        id: integer().primaryKey().generatedAlwaysAsIdentity(),
        player_id: integer()
            .notNull()
            .references(() => players.id, { onDelete: 'cascade' }),
        liturgy_id: uuid()
            .notNull()
            .references(() => liturgies.id, { onDelete: 'cascade' }),
        ftw: integer().default(0).notNull(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('player_liturgies_player_id_liturgy_id_key').on(t.player_id, t.liturgy_id)]
);

export const supernaturalCastings = pgTable('supernatural_castings', {
    id: uuid().primaryKey().defaultRandom(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    ability_type: text().notNull(), // SPELL | LITURGY
    spell_id: uuid().references(() => spells.id, { onDelete: 'set null' }),
    liturgy_id: uuid().references(() => liturgies.id, { onDelete: 'set null' }),
    ability_name: text().notNull(),
    target_player_id: integer().references(() => players.id, { onDelete: 'set null' }),
    target_combatant_id: uuid().references(() => combatants.id, { onDelete: 'set null' }),
    status: text().default('COMPLETED').notNull(), // PENDING | COMPLETED | FAILED | CANCELLED
    resource_cost: integer().default(0).notNull(),
    probe_result: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    effect_result: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    completes_at: timestamp({ withTimezone: true }),
    completed_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const supernaturalEffects = pgTable('supernatural_effects', {
    id: uuid().primaryKey().defaultRandom(),
    casting_id: uuid()
        .notNull()
        .references(() => supernaturalCastings.id, { onDelete: 'cascade' }),
    caster_player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    target_player_id: integer().references(() => players.id, { onDelete: 'set null' }),
    target_combatant_id: uuid().references(() => combatants.id, { onDelete: 'set null' }),
    ability_type: text().notNull(),
    ability_name: text().notNull(),
    effect_type: text().notNull(),
    effect_data: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    duration_type: text().default('instant').notNull(),
    duration_remaining: integer(),
    expires_at: timestamp({ withTimezone: true }),
    active: boolean().default(false).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const apTransactions = pgTable('ap_transactions', {
    id: uuid().primaryKey().defaultRandom(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    amount: integer().notNull(),
    balance_after: integer().notNull(),
    category: text().notNull(),
    reference_type: text(),
    reference_id: text(),
    description: text(),
    actor_discord_id: text().notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const wallets = pgTable('wallets', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    player_id: integer()
        .notNull()
        .unique()
        .references(() => players.id, { onDelete: 'cascade' }),
    balance_kreuzer: integer().default(0).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const walletTransactions = pgTable('wallet_transactions', {
    id: uuid().primaryKey().defaultRandom(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    amount_kreuzer: integer().notNull(),
    balance_after: integer().notNull(),
    category: text().notNull(),
    reference_type: text(),
    reference_id: text(),
    description: text(),
    actor_discord_id: text().notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const equipmentCatalog = pgTable('equipment_catalog', {
    id: uuid().primaryKey().defaultRandom(),
    external_id: text().notNull().unique(),
    name: text().notNull(),
    category: text().notNull(), // WEAPON | SHIELD | ARMOR | CLOTHING | GEAR | CONSUMABLE | VALUABLE
    subcategory: text(),
    description: text(),
    source_url: text(),
    price_kreuzer: integer().default(0).notNull(),
    weight_grams: integer().default(0).notNull(),
    default_slot: text(),
    armor_rs: integer().default(0).notNull(),
    armor_be: integer().default(0).notNull(),
    shield_pa_bonus: integer().default(0).notNull(),
    weapon_type: weaponTypeEnum(),
    combat_technique: text(),
    tp: text(),
    at_modifier: integer().default(0).notNull(),
    pa_modifier: integer().default(0).notNull(),
    range_close: integer(),
    range_medium: integer(),
    range_far: integer(),
    reload_actions: integer().default(0).notNull(),
    is_two_handed: boolean().default(false).notNull(),
    raw_properties: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const weapons = pgTable('weapons', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    catalog_id: uuid().references(() => equipmentCatalog.id, { onDelete: 'set null' }),
    name: text().notNull(),
    type: weaponTypeEnum(),
    combat_technique: text(),
    tp: text(),
    at: integer().default(0).notNull(),
    pa: integer().default(0).notNull(),
    range_close: integer(),
    range_medium: integer(),
    range_far: integer(),
    reload_actions: integer().default(0).notNull(),
    is_two_handed: boolean().default(false).notNull(),
    price_kreuzer: integer().default(0).notNull(),
    weight_grams: integer().default(0).notNull(),
    shield_pa_bonus: integer().default(0).notNull(),
    is_equipped: equippedStatusEnum().default('N').notNull(),
    equipped_slot: equippedSlotEnum(),
});

export const items = pgTable('items', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    catalog_id: uuid().references(() => equipmentCatalog.id, { onDelete: 'set null' }),
    name: text().notNull(),
    type: text().notNull(),
    effect: text(),
    description: text(),
    quantity: integer().default(1).notNull(),
    price_kreuzer: integer().default(0).notNull(),
    weight_grams: integer().default(0).notNull(),
    is_equipped: boolean().default(false).notNull(),
    default_slot: text(),
    equipped_slot: text(),
    armor_rs: integer().default(0).notNull(),
    armor_be: integer().default(0).notNull(),
});

export const trades = pgTable('trades', {
    id: uuid().primaryKey().defaultRandom(),
    initiator_player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    recipient_player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    status: text().default('PENDING').notNull(), // PENDING | ACCEPTED | DECLINED | CANCELLED | EXPIRED
    offered_kreuzer: integer().default(0).notNull(),
    requested_kreuzer: integer().default(0).notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const tradeItems = pgTable('trade_items', {
    id: uuid().primaryKey().defaultRandom(),
    trade_id: uuid()
        .notNull()
        .references(() => trades.id, { onDelete: 'cascade' }),
    side: text().notNull(), // OFFER | REQUEST
    asset_type: text().notNull(), // ITEM | WEAPON
    asset_id: integer().notNull(),
    quantity: integer().default(1).notNull(),
    name_snapshot: text().notNull(),
});

export const lootPools = pgTable('loot_pools', {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid()
        .notNull()
        .references(() => combatSessions.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    tier: integer().notNull(),
    status: text().default('OPEN').notNull(), // OPEN | DISTRIBUTED | CANCELLED
    currency_remaining_kreuzer: integer().default(0).notNull(),
    created_by_discord_id: text().notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const lootEntries = pgTable('loot_entries', {
    id: uuid().primaryKey().defaultRandom(),
    pool_id: uuid()
        .notNull()
        .references(() => lootPools.id, { onDelete: 'cascade' }),
    catalog_id: uuid()
        .notNull()
        .references(() => equipmentCatalog.id, { onDelete: 'restrict' }),
    quantity_remaining: integer().default(1).notNull(),
});

export const mobs = pgTable('mobs', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull().unique(),
    description: text(),
    base_max_hp: integer().notNull(),
    base_initiative: integer().notNull(),
    base_attack_value: integer().notNull(),
    base_parry_value: integer().notNull(),
    base_armor_soak: integer().notNull(),
    base_damage_tp: text(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Combat tables
// ---------------------------------------------------------------------------

export const combatSessions = pgTable('combat_sessions', {
    id: uuid().primaryKey().defaultRandom(),
    channel_id: text().notNull(),
    dm_user_id: text().notNull(),
    message_id: text(),
    state: combatStateEnum().default('SETUP').notNull(),
    turn_order: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    current_turn_index: integer().default(0).notNull(),
    current_round: integer().default(0).notNull(),
    combat_log: text()
        .array()
        .default(sql`'{}'::text[]`)
        .notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const combatants = pgTable('combatants', {
    id: uuid().primaryKey().defaultRandom(),
    session_id: uuid()
        .notNull()
        .references(() => combatSessions.id, { onDelete: 'cascade' }),
    type: combatantTypeEnum().notNull(),
    allegiance: combatantAllegianceEnum().notNull(),
    player_id: integer().references(() => players.id, { onDelete: 'set null' }),
    discord_user_id: text(),
    mob_definition_id: integer().references(() => mobs.id, { onDelete: 'set null' }),
    name: text().notNull(),
    max_hp: integer().notNull(),
    current_hp: integer().notNull(),
    wounds: integer().default(0).notNull(),
    wound_threshold: integer(),
    defense_count: integer().default(0).notNull(),
    creature_size: text().default('medium').notNull(),
    last_hit_zone: text(),
    movement_speed: integer().default(8).notNull(),
    reload_remaining: integer().default(0).notNull(),
    initiative_base: integer().default(0).notNull(),
    initiative_roll: integer(),
    is_active_turn: boolean().default(false).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// Leveled Zustände (Stufe I-IV)
export const combatantConditions = pgTable(
    'combatant_conditions',
    {
        id: uuid().primaryKey().defaultRandom(),
        combatant_id: uuid()
            .notNull()
            .references(() => combatants.id, { onDelete: 'cascade' }),
        condition_type: text().notNull(),
        level: integer().notNull(),
        source: text(),
        duration_type: text(), // rounds | minutes | hours | rest | permanent
        duration_remaining: integer(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('combatant_conditions_combatant_id_condition_type_key').on(t.combatant_id, t.condition_type)]
);

// Binary on/off status effects
export const combatantStatuses = pgTable(
    'combatant_statuses',
    {
        id: uuid().primaryKey().defaultRandom(),
        combatant_id: uuid()
            .notNull()
            .references(() => combatants.id, { onDelete: 'cascade' }),
        status_type: text().notNull(),
        source: text(),
        duration_rounds: integer(), // null = permanent
        effect_data: jsonb()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('combatant_statuses_combatant_id_status_type_key').on(t.combatant_id, t.status_type)]
);

/** Persisted buffs, debuffs, and stances shared by combat, magic, and Karma. */
export const combatantEffects = pgTable(
    'combatant_effects',
    {
        id: uuid().primaryKey().defaultRandom(),
        combatant_id: uuid()
            .notNull()
            .references(() => combatants.id, { onDelete: 'cascade' }),
        effect_type: text().notNull(),
        source: text(),
        at_modifier: integer().default(0).notNull(),
        pa_modifier: integer().default(0).notNull(),
        damage_modifier: integer().default(0).notNull(),
        armor_modifier: integer().default(0).notNull(),
        check_modifier: integer().default(0).notNull(),
        prohibits_actions: boolean().default(false).notNull(),
        prohibits_defense: boolean().default(false).notNull(),
        duration_rounds: integer(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    },
    t => [unique('combatant_effects_combatant_id_effect_type_key').on(t.combatant_id, t.effect_type)]
);

/** Audit ledger for Heilkunde Wunden applications. */
export const woundTreatments = pgTable('wound_treatments', {
    id: uuid().primaryKey().defaultRandom(),
    target_player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    healer_player_id: integer()
        .notNull()
        .references(() => players.id, { onDelete: 'cascade' }),
    combatant_id: uuid().references(() => combatants.id, { onDelete: 'set null' }),
    treatment_type: text().notNull(),
    success: boolean().notNull(),
    critical_success: boolean().default(false).notNull(),
    fumble: boolean().default(false).notNull(),
    quality_level: integer().default(0).notNull(),
    life_points_changed: integer().default(0).notNull(),
    wounds_healed: integer().default(0).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Rules knowledge base (pgvector). DDL cross-checked against RULES_VECTOR_DB.md.
// ---------------------------------------------------------------------------

export const rulePages = pgTable('rule_pages', {
    id: uuid().primaryKey().defaultRandom(),
    doc_id: text().notNull().unique(),
    source_item_id: text(),
    source_url: text().notNull().unique(),
    url_hash: text().notNull(),
    canonical_slug: text().notNull().unique(),
    title: text().notNull(),
    category: text().notNull(),
    resolved_category: text(),
    subcategory: text(),
    page_state: text(),
    is_unresolved: boolean().default(false).notNull(),
    resolution_confidence: text(),
    normalized_content: text().notNull(),
    content_hash: text().notNull(),
    parser_version: text().notNull(),
    scraper_version: text().notNull(),
    source_snapshot_at: timestamp({ withTimezone: true }),
    version: integer().default(1).notNull(),
    metadata: jsonb()
        .default(sql`'{}'::jsonb`)
        .notNull(),
    last_seen_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deleted_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const ruleChunks = pgTable(
    'rule_chunks',
    {
        id: uuid().primaryKey().defaultRandom(),
        chunk_id: text().notNull().unique(),
        page_id: uuid()
            .notNull()
            .references(() => rulePages.id, { onDelete: 'cascade' }),
        version: integer().notNull(),
        chunk_index: integer().notNull(),
        title: text(),
        category: text().notNull(),
        resolved_category: text(),
        heading: text(),
        chunk_text: text().notNull(),
        char_start: integer(),
        char_end: integer(),
        embedding: vector({ length: 1536 }),
        embedding_model: text(),
        embedded_at: timestamp({ withTimezone: true }),
        is_unresolved: boolean().default(false).notNull(),
        metadata: jsonb()
            .default(sql`'{}'::jsonb`)
            .notNull(),
        created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
        is_active: boolean().default(true).notNull(),
    },
    t => [unique('rule_chunks_page_id_version_chunk_index_key').on(t.page_id, t.version, t.chunk_index)]
);

// Note: the HNSW index on rule_chunks.embedding and the match_rule_chunks()
// function are created via a raw SQL migration (db/sql/rules_vector.sql) —
// Drizzle cannot express either. See RULES_VECTOR_DB.md for the canonical DDL.
