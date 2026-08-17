CREATE TABLE "session_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"session_date" text,
	"created_by_discord_id" text NOT NULL,
	"updated_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
