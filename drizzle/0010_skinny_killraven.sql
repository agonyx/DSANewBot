CREATE TABLE "dice_macros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" integer NOT NULL,
	"name" text NOT NULL,
	"notation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dice_macros_player_id_name_key" UNIQUE("player_id","name")
);
--> statement-breakpoint
ALTER TABLE "dice_macros" ADD CONSTRAINT "dice_macros_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;