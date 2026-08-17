CREATE TABLE "combatant_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"combatant_id" uuid NOT NULL,
	"effect_type" text NOT NULL,
	"source" text,
	"at_modifier" integer DEFAULT 0 NOT NULL,
	"pa_modifier" integer DEFAULT 0 NOT NULL,
	"damage_modifier" integer DEFAULT 0 NOT NULL,
	"armor_modifier" integer DEFAULT 0 NOT NULL,
	"check_modifier" integer DEFAULT 0 NOT NULL,
	"prohibits_actions" boolean DEFAULT false NOT NULL,
	"prohibits_defense" boolean DEFAULT false NOT NULL,
	"duration_rounds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combatant_effects_combatant_id_effect_type_key" UNIQUE("combatant_id","effect_type")
);
--> statement-breakpoint
ALTER TABLE "combatant_statuses" ADD COLUMN "effect_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "defense_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "creature_size" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "last_hit_zone" text;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "movement_speed" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "reload_remaining" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "range_close" integer;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "range_medium" integer;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "range_far" integer;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "reload_actions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "is_two_handed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "combatant_effects" ADD CONSTRAINT "combatant_effects_combatant_id_combatants_id_fk" FOREIGN KEY ("combatant_id") REFERENCES "public"."combatants"("id") ON DELETE cascade ON UPDATE no action;