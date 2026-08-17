CREATE TABLE "equipment_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"description" text,
	"source_url" text,
	"price_kreuzer" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"default_slot" text,
	"armor_rs" integer DEFAULT 0 NOT NULL,
	"armor_be" integer DEFAULT 0 NOT NULL,
	"shield_pa_bonus" integer DEFAULT 0 NOT NULL,
	"weapon_type" "weapon_type",
	"combat_technique" text,
	"tp" text,
	"at_modifier" integer DEFAULT 0 NOT NULL,
	"pa_modifier" integer DEFAULT 0 NOT NULL,
	"range_close" integer,
	"range_medium" integer,
	"range_far" integer,
	"reload_actions" integer DEFAULT 0 NOT NULL,
	"is_two_handed" boolean DEFAULT false NOT NULL,
	"raw_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_catalog_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "loot_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	"quantity_remaining" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loot_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tier" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"currency_remaining_kreuzer" integer DEFAULT 0 NOT NULL,
	"created_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"side" text NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"name_snapshot" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_player_id" integer NOT NULL,
	"recipient_player_id" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"offered_kreuzer" integer DEFAULT 0 NOT NULL,
	"requested_kreuzer" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" integer NOT NULL,
	"amount_kreuzer" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"category" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"actor_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"balance_kreuzer" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "catalog_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "price_kreuzer" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_equipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "default_slot" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "equipped_slot" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "armor_rs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "armor_be" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "natural_armor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "stats" SET "natural_armor" = GREATEST(0, "ruestungsschutz");--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "belastung" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "catalog_id" uuid;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "price_kreuzer" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "weight_grams" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "shield_pa_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "loot_entries" ADD CONSTRAINT "loot_entries_pool_id_loot_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."loot_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_entries" ADD CONSTRAINT "loot_entries_catalog_id_equipment_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_pools" ADD CONSTRAINT "loot_pools_session_id_combat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."combat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_player_id_players_id_fk" FOREIGN KEY ("initiator_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_recipient_player_id_players_id_fk" FOREIGN KEY ("recipient_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_catalog_id_equipment_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weapons" ADD CONSTRAINT "weapons_catalog_id_equipment_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."equipment_catalog"("id") ON DELETE set null ON UPDATE no action;
