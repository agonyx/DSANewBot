CREATE TABLE "player_special_abilities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_special_abilities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" integer NOT NULL,
	"special_ability_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_special_abilities_player_id_special_ability_id_key" UNIQUE("player_id","special_ability_id")
);
--> statement-breakpoint
CREATE TABLE "special_abilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"description" text,
	"source_url" text,
	"ap_cost" integer NOT NULL,
	"prerequisites" text,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"raw_properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_abilities_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "player_special_abilities" ADD CONSTRAINT "player_special_abilities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_special_abilities" ADD CONSTRAINT "player_special_abilities_special_ability_id_special_abilities_id_fk" FOREIGN KEY ("special_ability_id") REFERENCES "public"."special_abilities"("id") ON DELETE cascade ON UPDATE no action;