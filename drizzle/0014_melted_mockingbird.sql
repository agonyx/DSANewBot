CREATE TABLE "combat_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_id" uuid,
	"action_kind" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"decision" text,
	"decision_by_discord_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "action_spent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "free_action_spent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "ongoing_action" jsonb;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "is_dropped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "dropped_session_id" uuid;--> statement-breakpoint
ALTER TABLE "weapons" ADD COLUMN "dropped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "combat_actions" ADD CONSTRAINT "combat_actions_session_id_combat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."combat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_actions" ADD CONSTRAINT "combat_actions_actor_id_combatants_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."combatants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_actions" ADD CONSTRAINT "combat_actions_target_id_combatants_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."combatants"("id") ON DELETE set null ON UPDATE no action;