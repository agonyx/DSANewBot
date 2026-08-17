CREATE TABLE "initiative_trackers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"title" text DEFAULT 'Initiative' NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_entry_index" integer DEFAULT 0 NOT NULL,
	"current_round" integer DEFAULT 1 NOT NULL,
	"created_by_discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_trackers_guild_id_channel_id_key" UNIQUE("guild_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "party_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"discord_id" text NOT NULL,
	"player_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_memberships_guild_id_discord_id_key" UNIQUE("guild_id","discord_id")
);
--> statement-breakpoint
ALTER TABLE "party_memberships" ADD CONSTRAINT "party_memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;