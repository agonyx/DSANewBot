CREATE TABLE "campaign_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_discord_id" text NOT NULL,
	"updated_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_records_guild_kind_name_key" UNIQUE("guild_id","kind","name")
);
--> statement-breakpoint
CREATE TABLE "campaign_worlds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"current_time" timestamp with time zone DEFAULT now() NOT NULL,
	"weather" text DEFAULT 'Clear' NOT NULL,
	"updated_by_discord_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_records_player_kind_name_key" UNIQUE("player_id","kind","name")
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"event_types" jsonb DEFAULT '["*"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_subscriptions_guild_name_key" UNIQUE("guild_id","name")
);
--> statement-breakpoint
ALTER TABLE "character_records" ADD CONSTRAINT "character_records_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;