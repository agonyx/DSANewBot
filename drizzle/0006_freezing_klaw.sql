CREATE TABLE "ap_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"category" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"actor_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liturgies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"probe_attr1" text,
	"probe_attr2" text,
	"probe_attr3" text,
	"traditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"aspects" text[] DEFAULT '{}'::text[] NOT NULL,
	"resource_cost" integer DEFAULT 0 NOT NULL,
	"permanent_cost" integer DEFAULT 0 NOT NULL,
	"casting_time" text,
	"casting_time_actions" integer DEFAULT 0 NOT NULL,
	"casting_time_minutes" integer DEFAULT 0 NOT NULL,
	"range" text,
	"duration" text,
	"target_category" text,
	"advancement_factor" text,
	"ap_cost" integer DEFAULT 1 NOT NULL,
	"description" text,
	"source_url" text,
	"effect_type" text DEFAULT 'UTILITY' NOT NULL,
	"effect_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "liturgies_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "player_liturgies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_liturgies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"liturgy_id" uuid NOT NULL,
	"ftw" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_liturgies_player_id_liturgy_id_key" UNIQUE("player_id","liturgy_id")
);
--> statement-breakpoint
CREATE TABLE "player_spells" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_spells_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"spell_id" uuid NOT NULL,
	"ftw" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_spells_player_id_spell_id_key" UNIQUE("player_id","spell_id")
);
--> statement-breakpoint
CREATE TABLE "spells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"probe_attr1" text,
	"probe_attr2" text,
	"probe_attr3" text,
	"traditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"feature" text,
	"resource_cost" integer DEFAULT 0 NOT NULL,
	"permanent_cost" integer DEFAULT 0 NOT NULL,
	"casting_time" text,
	"casting_time_actions" integer DEFAULT 0 NOT NULL,
	"casting_time_minutes" integer DEFAULT 0 NOT NULL,
	"range" text,
	"duration" text,
	"target_category" text,
	"advancement_factor" text,
	"ap_cost" integer DEFAULT 1 NOT NULL,
	"description" text,
	"source_url" text,
	"effect_type" text DEFAULT 'UTILITY' NOT NULL,
	"effect_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spells_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "supernatural_castings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" integer NOT NULL,
	"ability_type" text NOT NULL,
	"spell_id" uuid,
	"liturgy_id" uuid,
	"ability_name" text NOT NULL,
	"target_player_id" integer,
	"target_combatant_id" uuid,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"resource_cost" integer DEFAULT 0 NOT NULL,
	"probe_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completes_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supernatural_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"casting_id" uuid NOT NULL,
	"caster_player_id" integer NOT NULL,
	"target_player_id" integer,
	"target_combatant_id" uuid,
	"ability_type" text NOT NULL,
	"ability_name" text NOT NULL,
	"effect_type" text NOT NULL,
	"effect_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_type" text DEFAULT 'instant' NOT NULL,
	"duration_remaining" integer,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supernatural_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supernatural_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"magical_tradition" text,
	"blessed_tradition" text,
	"deity" text,
	"favored_talents" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supernatural_profiles_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "ap_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "ap_available" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "ap_spent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ap_transactions" ADD CONSTRAINT "ap_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_liturgies" ADD CONSTRAINT "player_liturgies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_liturgies" ADD CONSTRAINT "player_liturgies_liturgy_id_liturgies_id_fk" FOREIGN KEY ("liturgy_id") REFERENCES "public"."liturgies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_spells" ADD CONSTRAINT "player_spells_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_spells" ADD CONSTRAINT "player_spells_spell_id_spells_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."spells"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_castings" ADD CONSTRAINT "supernatural_castings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_castings" ADD CONSTRAINT "supernatural_castings_spell_id_spells_id_fk" FOREIGN KEY ("spell_id") REFERENCES "public"."spells"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_castings" ADD CONSTRAINT "supernatural_castings_liturgy_id_liturgies_id_fk" FOREIGN KEY ("liturgy_id") REFERENCES "public"."liturgies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_castings" ADD CONSTRAINT "supernatural_castings_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_castings" ADD CONSTRAINT "supernatural_castings_target_combatant_id_combatants_id_fk" FOREIGN KEY ("target_combatant_id") REFERENCES "public"."combatants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_effects" ADD CONSTRAINT "supernatural_effects_casting_id_supernatural_castings_id_fk" FOREIGN KEY ("casting_id") REFERENCES "public"."supernatural_castings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_effects" ADD CONSTRAINT "supernatural_effects_caster_player_id_players_id_fk" FOREIGN KEY ("caster_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_effects" ADD CONSTRAINT "supernatural_effects_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_effects" ADD CONSTRAINT "supernatural_effects_target_combatant_id_combatants_id_fk" FOREIGN KEY ("target_combatant_id") REFERENCES "public"."combatants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supernatural_profiles" ADD CONSTRAINT "supernatural_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;