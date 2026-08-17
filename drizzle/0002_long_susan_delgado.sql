CREATE TABLE "wound_treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_player_id" integer NOT NULL,
	"healer_player_id" integer NOT NULL,
	"combatant_id" uuid,
	"treatment_type" text NOT NULL,
	"success" boolean NOT NULL,
	"critical_success" boolean DEFAULT false NOT NULL,
	"fumble" boolean DEFAULT false NOT NULL,
	"quality_level" integer DEFAULT 0 NOT NULL,
	"life_points_changed" integer DEFAULT 0 NOT NULL,
	"wounds_healed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "pending_healing_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "pain_suppression" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "pain_suppression_phases" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "pain_modifier" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wound_treatments" ADD CONSTRAINT "wound_treatments_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wound_treatments" ADD CONSTRAINT "wound_treatments_healer_player_id_players_id_fk" FOREIGN KEY ("healer_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wound_treatments" ADD CONSTRAINT "wound_treatments_combatant_id_combatants_id_fk" FOREIGN KEY ("combatant_id") REFERENCES "public"."combatants"("id") ON DELETE set null ON UPDATE no action;