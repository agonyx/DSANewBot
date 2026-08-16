# DSA5-Dokument V1.93 import profile

Profile ID: `DSA5_DOCUMENT_1_93`

The importer recognizes this fillable character sheet by its PDF title, 12-page
layout, sorted field-name/type signature, and sentinel AcroForm fields. The
original filename and character values are never part of profile detection.
The inspected compatible signature is recorded in code, while sentinel-
compatible revisions are accepted with a preview warning.

## Safety contract

- Maximum upload: 10 MiB, 20 pages, 5,000 form fields, and 8 seconds of parsing.
- `%PDF-` magic and PDF MIME are validated before parsing.
- Encrypted and malformed documents are rejected.
- AcroForm values are read directly. OCR is not used, and embedded actions or
  JavaScript are never executed.
- Parent names, choice selections, checkboxes, and fields with multiple widgets
  are normalized to one canonical field entry.
- Logs contain only the profile/version and aggregate page/field counts.

## Mapping inventory

| Sheet area     | Field families                                                | DSANewBot target                             |
| -------------- | ------------------------------------------------------------- | -------------------------------------------- |
| Identity       | `Held_Name`, `Held_Spezies`, `Held_Kultur`, `Held_Profession` | player and `BACKGROUND` record               |
| Attributes     | `MU_1` through `KK_1`                                         | eight core stats                             |
| Resources      | `LE_*`, `AE_*`, `KE_*`, `SchiP_*`                             | LeP, AsP, KaP, SchP current/max              |
| Derived/AP     | `INI_*`, `AW_*`, `SK_*`, `ZK_*`, `AP_*`                       | initiative, dodge, SK/ZK, AP totals          |
| Talents        | `Talent_R_*`, `Talent_FW_*`, `Talent_Anmerkung_*`             | reconciled `player_talents`                  |
| Techniques     | `KaT_Name_*`, `KaT_AT_*`, `KaT_PA_*`                          | `COMBAT_TECHNIQUE` records and base AT/PA    |
| Melee weapons  | `Nahwaffe_*`, `Nah_*`                                         | weapons, stats, equipment state              |
| Ranged weapons | `Fernwaffe_*`, `Fern_*`                                       | weapons, ranges, reload, equipment state     |
| Shields        | `Schild_*`                                                    | shield weapons and defense slot              |
| Armor          | `Ruestung_*`                                                  | armor items and equipped state               |
| Zoned armor    | `ZoneRS_*`, `ZonenRuestung_*`                                 | `ZONED_ARMOR` records                        |
| Abilities      | `SF_Kampf_*`, `SF_allg_*`, `SF_mag_*`, `SF_karm_*`            | maneuver/special-ability catalogs or records |
| Supernatural   | `Zauber_*`, `Liturgie_*`, `ZauberLiturgie_*`, FW families     | spell/liturgy catalogs and learned FW        |
| Advantages     | `Vorteil_*`                                                   | `ADVANTAGE` records                          |
| Disadvantages  | `Nachteil_*`                                                  | `DISADVANTAGE` records                       |

Catalog names are classified as exact, normalized, alias, ambiguous, or
unresolved. Unknown non-empty fields and unresolved catalog rows are saved in
one `IMPORT_UNRESOLVED` report and are visible through
`/character import-report`; they are never silently discarded.

## Known interpretation choices

- The first explicitly equipped offensive weapon and shield are assigned to
  their corresponding slots. If the sheet leaves all equipment toggles blank,
  the first suitable entries are selected so the imported character is usable.
- Combat techniques do not yet have a dedicated relation, so their values are
  losslessly stored as character records.
- Zoned armor, advantages, and disadvantages use typed character records rather
  than expanding the core stats table. SK and ZK are dedicated stat columns.
