# Advancement Rules Decisions

This document is the acceptance reference for DSANewBot's AP ledger and character-improvement workflow. The implementation is shared by `services/advancement.ts`, `/api/advancement`, `/advance`, and the backward-compatible `/edit-skills` alias.

## Rules sources and progression model

- The local Regelwiki entry `Steigern von Eigenschaften und Fertigkeiten` in `DSA5WikiScraper/dsa_scraper_v3/data/json/rules.json` is authoritative for AP purchases. DSA 5 has no numeric character levels: the roadmap's "level-up" requirement is implemented as atomic, one-point purchases.
- Talents are always active. A character receives every seeded talent at FW 0, so there is no separate talent activation cost. New spells, rituals, liturgies, ceremonies, and special abilities are activated for their fixed catalog AP cost.
- Tricks and blessings cost 1 AP to activate but have no FW and cannot be improved.

## Improvement costs and caps

Talent, spell, and liturgy improvements use the target value and the DSA advancement column:

| Target value |                                    A |   B |   C |   D |
| ------------ | -----------------------------------: | --: | --: | --: |
| 1–12         |                                    1 |   2 |   3 |   4 |
| 13           |                                    2 |   4 |   6 |   8 |
| 14           |                                    3 |   6 |   9 |  12 |
| 15           |                                    4 |   8 |  12 |  16 |
| 16           |                                    5 |  10 |  15 |  20 |
| 17           |                                    6 |  12 |  18 |  24 |
| 18           |                                    8 |  16 |  24 |  32 |
| 19+          | rises by 2/4/6/8 AP per target point |     |     |     |

- Attributes cost 15 AP per increase through target value 14. Target 15 costs 30 AP, target 16 costs 45 AP, and each later target adds another 15 AP.
- A talent's cap is the highest of its three participating attributes plus 2.
- Spells, rituals, liturgies, and ceremonies are capped at FW 14 because feature/aspect knowledge is not yet represented on the character sheet. The API returns a rule error instead of silently exceeding that cap.
- Talents carry their Regelwiki category, advancement factor, and encumbrance flag in the catalog. Only talents marked as affected receive Belastung penalties.

## Ledger, atomicity, and authorization

- `stats.ap_total` is lifetime awarded AP, `ap_available` is the spendable balance, and `ap_spent` is the cumulative amount spent through the advancement workflow.
- Every award, activation, and improvement writes an `ap_transactions` audit row with the resulting balance and authenticated Discord actor. The balance, acquired row, and improved value change in one database transaction; insufficient AP or failed prerequisites roll back the complete purchase.
- All public operations resolve the selected character from the authenticated Discord identity. AP awards are explicit tabletop-session entries made by that character owner and require a reason.
- `/advance` is the canonical player workflow. `/edit-skills` now invokes the same AP-backed special-ability service and cannot remove or freely assign abilities.
- `PATCH /characters/stats` and `POST /talents/skills` remain explicit owner/tabletop sheet overrides for importing or correcting an existing paper character. They do not forge ledger history and are intentionally not presented as advancement commands.

## Special abilities

- The curated combat-ability catalog stores a first-class AP cost and structured prerequisites. Learning checks attribute minimums, `GE or KK`, required predecessor abilities, and qualifying combat techniques before spending AP.
- Fixed-cost magical and karmic special abilities are imported from the local `special_abilities_magical.json` and `special_abilities_karmale.json` Regelwiki exports. The current source snapshot yields 995 unambiguous executable entries. Variable, tiered, and per-level cost descriptions are deliberately excluded because choosing a cost without a selected variant would undercharge AP.
- Core attribute minimums found in source prerequisite text are checked automatically. Magical abilities require a configured magical tradition; karmic abilities require a blessed tradition and deity. Because many source prerequisites refer to abilities, traditions, cultures, or choices that are not machine-normalized, those rows require an explicit `prerequisites_confirmed` acknowledgement. The original prerequisite text is returned in the error and retained with its source URL for table adjudication.
- Equipment-state and action-state requirements such as free hands or movement remain runtime maneuver checks; they are not permanent learning prerequisites.
- Costs and prerequisites for the implemented maneuver catalog are drawn from `docs/combat-maneuvers-reference.md`, `docs/additional-combat-maneuvers.md`, `docs/missing-combat-maneuvers.md`, and the called-shot entries in `docs/wound-system-rules.md`.

## Migration and compatibility

Migration `0008_new_mentor.sql` adds talent advancement metadata, first-class combat-ability costs, and unique ownership constraints. Before adding those constraints it preserves the highest duplicate talent FW and removes duplicate ownership rows. It corrects `Spährenkunde` to `Sphärenkunde`, backfills existing catalogs, and creates missing FW 0 talent rows for existing characters. Migration `0009_faithful_vance_astro.sql` adds the generic special-ability catalog and unique learned relation. The idempotent catalog seeds update older rows on conflict so future rules-data refreshes do not leave stale costs, prerequisites, or flags.
