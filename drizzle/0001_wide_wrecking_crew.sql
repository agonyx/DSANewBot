ALTER TABLE "combatants" ADD COLUMN "wounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "combatants" ADD COLUMN "wound_threshold" integer;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "wounds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stats" ADD COLUMN "wound_threshold_modifier" integer DEFAULT 0 NOT NULL;