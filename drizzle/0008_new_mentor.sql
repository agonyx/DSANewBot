ALTER TABLE "action_modifications" ADD COLUMN "ap_cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "talents" ADD COLUMN "category" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "talents" ADD COLUMN "advancement_factor" text DEFAULT 'B' NOT NULL;--> statement-breakpoint
ALTER TABLE "talents" ADD COLUMN "affected_by_encumbrance" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "talents" SET "name" = 'Sphärenkunde' WHERE "name" = 'Spährenkunde';--> statement-breakpoint
UPDATE "talents" AS t
SET "category" = source.category,
    "advancement_factor" = source.factor,
    "affected_by_encumbrance" = source.encumbered
FROM (VALUES
    ('Alchemie', 'Handwerk', 'C', true),
    ('Bekehren & Überzeugen', 'Gesellschaft', 'B', false),
    ('Betören', 'Gesellschaft', 'B', false),
    ('Boote & Schiffe', 'Handwerk', 'B', true),
    ('Brett & Glücksspiel', 'Wissen', 'A', false),
    ('Einschüchtern', 'Gesellschaft', 'B', false),
    ('Etikette', 'Gesellschaft', 'B', false),
    ('Fährtensuchen', 'Natur', 'C', true),
    ('Fahrzeuge', 'Handwerk', 'A', true),
    ('Fesseln', 'Handwerk', 'A', false),
    ('Fischen & Angeln', 'Natur', 'A', true),
    ('Fliegen', 'Körper', 'B', true),
    ('Gassenwissen', 'Gesellschaft', 'C', false),
    ('Gaukeleien', 'Körper', 'A', true),
    ('Geographie', 'Wissen', 'B', false),
    ('Geschichtswissen', 'Wissen', 'B', false),
    ('Götter & Kulte', 'Wissen', 'B', false),
    ('Handel', 'Gesellschaft', 'B', false),
    ('Heilkunde: Gift', 'Wissen', 'B', true),
    ('Heilkunde: Krankheiten', 'Wissen', 'B', true),
    ('Heilkunde: Seele', 'Wissen', 'B', false),
    ('Heilkunde: Wunden', 'Wissen', 'D', true),
    ('Holzbearbeitung', 'Handwerk', 'B', true),
    ('Klettern', 'Körper', 'B', true),
    ('Körperbeherrschung', 'Körper', 'D', true),
    ('Kraftakt', 'Körper', 'B', true),
    ('Kriegskunst', 'Wissen', 'B', false),
    ('Lebensmittelbearbeitung', 'Handwerk', 'A', true),
    ('Lederbearbeitung', 'Handwerk', 'B', true),
    ('Magiekunde', 'Wissen', 'C', false),
    ('Malen & Zeichnen', 'Handwerk', 'A', true),
    ('Mechanik', 'Wissen', 'B', false),
    ('Menschenkenntnis', 'Gesellschaft', 'C', false),
    ('Metallbearbeitung', 'Handwerk', 'C', true),
    ('Musizieren', 'Handwerk', 'A', true),
    ('Orientierung', 'Natur', 'B', false),
    ('Pflanzenkunde', 'Natur', 'C', true),
    ('Rechnen', 'Wissen', 'A', false),
    ('Rechtskunde', 'Wissen', 'A', false),
    ('Reiten', 'Körper', 'B', true),
    ('Sagen & Legenden', 'Wissen', 'B', false),
    ('Schlösserknacken', 'Handwerk', 'C', true),
    ('Schwimmen', 'Körper', 'B', true),
    ('Selbstbeherrschung', 'Körper', 'D', false),
    ('Singen', 'Handwerk', 'A', false),
    ('Sinnesschärfe', 'Körper', 'D', false),
    ('Sphärenkunde', 'Wissen', 'B', false),
    ('Steinbearbeitung', 'Handwerk', 'A', true),
    ('Sternkunde', 'Wissen', 'A', false),
    ('Stoffbearbeitung', 'Handwerk', 'A', true),
    ('Tanzen', 'Körper', 'A', true),
    ('Taschendiebstahl', 'Gesellschaft', 'B', true),
    ('Tierkunde', 'Natur', 'C', true),
    ('Überreden', 'Gesellschaft', 'C', false),
    ('Verbergen', 'Körper', 'C', true),
    ('Verkleiden', 'Gesellschaft', 'B', true),
    ('Wildnisleben', 'Natur', 'C', true),
    ('Willenskraft', 'Körper', 'D', false),
    ('Zechen', 'Körper', 'A', false)
) AS source(name, category, factor, encumbered)
WHERE t.name = source.name;--> statement-breakpoint
UPDATE "action_modifications" AS a
SET "ap_cost" = source.ap_cost
FROM (VALUES
    ('Wuchtschlag', 15),
    ('Finte', 15),
    ('Präziser Stich', 15),
    ('Entwaffnen', 40),
    ('Zu Fall bringen', 20),
    ('Haltegriff', 5),
    ('Gezielter Angriff', 10),
    ('Gezielter Schuss', 10),
    ('Sturmangriff', 25),
    ('Verteidigungshaltung', 10),
    ('Meisterparade', 25),
    ('Beidhändiger Kampf I', 20),
    ('Beidhändiger Kampf II', 35),
    ('Präziser Schuss', 15)
) AS source(name, ap_cost)
WHERE a.name = source.name;--> statement-breakpoint
DELETE FROM "player_action_modifications" AS duplicate
USING "player_action_modifications" AS keep
WHERE duplicate.player_id = keep.player_id
  AND duplicate.action_modification_id = keep.action_modification_id
  AND duplicate.id > keep.id;--> statement-breakpoint
UPDATE "player_talents" AS target
SET "ftw" = source.max_ftw
FROM (
    SELECT "player_id", "talent_id", MAX("ftw") AS max_ftw
    FROM "player_talents"
    GROUP BY "player_id", "talent_id"
) AS source
WHERE target.player_id = source.player_id
  AND target.talent_id = source.talent_id;--> statement-breakpoint
DELETE FROM "player_talents" AS duplicate
USING "player_talents" AS keep
WHERE duplicate.player_id = keep.player_id
  AND duplicate.talent_id = keep.talent_id
  AND duplicate.id > keep.id;--> statement-breakpoint
ALTER TABLE "player_action_modifications" ADD CONSTRAINT "player_action_modifications_player_id_action_modification_id_key" UNIQUE("player_id","action_modification_id");--> statement-breakpoint
ALTER TABLE "player_talents" ADD CONSTRAINT "player_talents_player_id_talent_id_key" UNIQUE("player_id","talent_id");--> statement-breakpoint
INSERT INTO "player_talents" ("player_id", "talent_id", "ftw")
SELECT p.id, t.id, 0
FROM "players" AS p
CROSS JOIN "talents" AS t
ON CONFLICT ("player_id", "talent_id") DO NOTHING;
