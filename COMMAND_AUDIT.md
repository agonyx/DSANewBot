## Redundancies

None. Every command serves a distinct purpose. Closest overlaps:

- `/heal` vs `/use-item` (potion) — `/heal` is DM godmode, `/use-item` is in-game mechanic. Keep both.
- `/attack` (standalone) vs combat button attacks — different contexts (out-of-combat vs in-combat). Keep both.
- `/park-combat` + `/resume-combat` + `/end-combat` — three commands for session state. Could be one command with subcommands, but current approach is fine for discoverability.

## Missing Commands

### Tier 1 — CRUD Gaps (broken workflows) ✅ FIXED

| Command       | Status  | Notes                                                                              |
| ------------- | ------- | ---------------------------------------------------------------------------------- |
| `edit-weapon` | ✅ Done | Interactive editor for weapon properties (name, type, tp, at, pa, equipped, slot)  |
| `edit-item`   | ✅ Done | Interactive editor for item properties (name, type, quantity, effect, description) |
| `delete-mob`  | ✅ Done | Delete mob templates with confirmation (DM-only)                                   |

### Tier 2 — Core DSA Mechanics ✅ DONE

| Command              | Status  | Notes                                                                                     |
| -------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `/schicksalspunkte`  | ✅ Done | Subcommands: spend, restore, set, show. Tracks fate points (default 3/3).                 |
| `/asp`               | ✅ Done | Subcommands: spend, restore, show. Astralpunkte for Zauberer (max 0 = non-caster).        |
| `/kap`               | ✅ Done | Subcommands: spend, restore, show. Karmapunkte for Geweihte (max 0 = non-blessed).        |
| `/condition`         | ✅ Done | Subcommands: add, remove, list. Leveled conditions (Schmerz, Betäubung, etc.) in combat.  |
| `/status`            | ✅ Done | Subcommands: add, remove, list. Binary status effects (Blutend, Liegend, etc.) in combat. |
| `/regeneration`      | ✅ Done | Regenerationsphase — rolls 1W6 per energy type (LeP, AsP if caster, KaP if blessed).      |
| `show-stats` updated | ✅ Done | Displays SchP, AsP, KaP, AP, wounds, armor, and Belastung.                                |
| `edit-stats` updated | ✅ Done | All new resource fields editable.                                                         |
| Combat display       | ✅ Done | Pain levels (P1-P4), condition/status indicators in roster and spotlight.                 |

### Tier 3 — Session Quality of Life ✅ DONE

| Feature                  | Status  | Evidence                                                                                            |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------- |
| **Loot/Treasure tables** | ✅ Done | `/loot` generates tiered ended-combat pools and distributes catalog items/currency to participants. |
| **Combat log command**   | ✅ Done | `/combat-log` and the authenticated API expose the latest active or ended log for the channel.      |
| **Maneuver library**     | ✅ Done | `/list-maneuvers`, `/show-maneuver`, and `/api/maneuvers` use the source-documented seeded catalog. |

### Tier 4 — Nice to Have (later)

| Feature                         | Notes                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Spell/Liturgy management        | ✅ Implemented under the committed Priority 2 roadmap scope        |
| Advantage/Disadvantage tracking | Character creation completeness                                    |
| XP/AP tracking & leveling       | ✅ Implemented as DSA AP purchases (DSA has no numeric levels)     |
| Encumbrance                     | ✅ Implemented with weight, armor BE, capacity, and penalties      |
| Character import (Optolith)     | Competitor "Das Weisse Auge" has 2-click hero import from Optolith |
| Name generator                  | Aventurian NPC names for DMs                                       |
| Notes/Journal                   | Session notes attached to combat encounters                        |
| Dice tables                     | DSA-specific critical hit and botch tables                         |

## Competitor: Das Weisse Auge

The most direct DSA 5e Discord bot competitor. Features they have that we don't:

- **Optolith import** — 2-click hero file import
- **7000+ visual playing cards** — equipment, spells, items rendered as card images
- **Botch/Crit tables** — random flavor tables for critical successes and failures
- **DM secret rolling** — roll checks without players seeing
- **Group management** — organize players into groups for secret checks

The playing cards system is what our planned canvas integration could rival.

## Current Command Inventory (62 commands)

### Character Management and Advancement (7)

- `/create-character` — Create new character
- `/choose-character` — Select active character
- `/show-stats` — View character attributes
- `/edit-stats` — Modify character attributes
- `/upload-avatar` — Set character image
- `/delete-character` — Remove character
- `/advance` — Show/award AP and improve attributes, FW, or special abilities

### Combat and Session State (13)

- `/start-combat` — Begin encounter
- `/end-combat` — Terminate encounter
- `/park-combat` — Pause encounter
- `/resume-combat` — Resume paused encounter
- `/attack` — Standalone attack roll (outside formal combat)
- `/evade` — Dodge attack
- `/heal` — Restore HP
- `/use-skill` — Execute combat maneuver
- `/combat-action` — Full defense, reload, escape, two-weapon, and opportunity actions
- `/combat-log` — Review active or ended combat logs
- `/condition` — Manage leveled combat conditions
- `/status` — Manage binary combat statuses
- `/effect` — Manage persisted combat buffs/debuffs

### Equipment, Inventory, and Economy (15)

- `/add-weapon` — Create weapon
- `/show-weapons` — List weapons
- `/equip-weapon` — Assign weapon to slot
- `/edit-weapon` — Modify weapon properties
- `/delete-weapon` — Remove weapon
- `/add-item` — Add inventory item
- `/show-items` — List inventory
- `/edit-item` — Modify item properties
- `/use-item` — Consume item
- `/remove-item` — Delete inventory item
- `/equipment` — Equip/wear gear and inspect load, RS, and Belastung
- `/wallet` — Show or adjust money with an audit ledger
- `/shop` — Browse, buy, and sell catalog equipment
- `/trade` — Offer and resolve atomic player trades
- `/loot` — Generate and distribute post-combat rewards

### Skills, Talents, and Maneuvers (5)

- `/probe` — Perform talent check (Talentprobe)
- `/edit-skills` — Legacy alias for AP-backed special-ability learning
- `/show-skills` — List assigned skills
- `/list-maneuvers` — Browse maneuver catalog
- `/show-maneuver` — Inspect maneuver rules and prerequisites

### Mob Management (5)

- `/add-mob` — Create mob template
- `/edit-mob` — Modify mob template
- `/delete-mob` — Delete mob template
- `/list-mobs` — View all templates
- `/show-mob` — View specific template

### Magic and Karma (9)

- `/asp` — Manage Astralpunkte (spend/restore/show)
- `/kap` — Manage Karmapunkte (spend/restore/show)
- `/spells` — Browse, learn, inspect, and cast spells/rituals
- `/liturgies` — Browse, learn, inspect, and perform liturgies/ceremonies
- `/tradition` — Configure magical/blessed traditions and deity
- `/miracle` — Use favored-talent/attack/defense miracles
- `/complete-casting` — Complete a pending ritual or ceremony
- `/cancel-casting` — Interrupt a pending casting with the documented refund
- `/supernatural-effects` — Inspect pending castings and tracked effects

### Resources and Wounds (3)

- `/schicksalspunkte` — Manage fate points (spend/restore/set/show)
- `/regeneration` — Roll regeneration for LeP/AsP/KaP and natural wound healing
- `/treat-wounds` — Treat healing, pain, stabilization, or bleeding

### Regelwiki (1)

- `/regel` — Semantic search across 7,196 DSA 5e rules

### Utility (2)

- `/help` — Command documentation
- `/roll` — Dice roller (DSA notation)

### Dev Only (2)

- `/dev-test-character` — Create test character
- `/dev-test-mobs` — Create test mobs

## Implementation Priority

1. ~~**Fix naming** (Tier 0) — `create-character`, `probe`, `show-mob`, `edit-skills`~~ ✅ DONE
2. ~~**CRUD gaps** (Tier 1) — `edit-weapon`, `edit-item`, `delete-mob`~~ ✅ DONE
3. ~~**Core DSA resources** (Tier 2) — fate points, astral/karma points, conditions, rest/regen~~ ✅ DONE
4. ~~**DM tools** (Tier 3) — loot tables, combat log command, maneuver library~~ ✅ DONE
5. **Canvas integration** — visual character cards, combat display, stat blocks
6. **Nice-to-have remainder** (Tier 4) — advantages/disadvantages and other explicitly deferred ideas
