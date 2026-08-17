# DSANewBot Roadmap

Feature audit and development roadmap for becoming a complete DSA 5th Edition tabletop companion.

Implementation checkpoint (2026-08-16): every software item in this roadmap is
implemented in the current worktree and passes the isolated full test gate. The
remaining unchecked acceptance criterion in the companion UX backlog is the
user's desktop/mobile screenshot approval for the Components V2 direction.
The live Netcup database, 46 global production commands, and bot runtime were
updated successfully on 2026-08-16 from Git revision `302536b`.

---

## ✅ Implemented Features

### Character Management

| Feature             | Command(s)          | Details                                        |
| ------------------- | ------------------- | ---------------------------------------------- |
| Character Creation  | `/character create` | Creates player with name                       |
| Character Selection | `/character select` | Multi-character support per Discord user       |
| Character Deletion  | `/character delete` | Remove characters                              |
| Avatar Upload       | `/character avatar` | Custom character portraits (Supabase storage)  |
| Character Export    | `/character export` | Download a complete UTF-8 text character sheet |

### Attributes & Stats

| Feature            | Location                           | Details                                    |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| 8 Core Attributes  | `stats` table                      | MU, KL, IN, CH, FF, GE, KO, KK             |
| Life Points (LP)   | `stats.le_max`, `stats.le_current` | Current/max tracking                       |
| Initiative         | `stats.initiative`                 | Base initiative value                      |
| Armor Soak (RS)    | `stats.ruestungsschutz`            | Natural plus equipped armor, synchronized  |
| Dodge (Ausweichen) | `stats.ausweichen`                 | Evasion value                              |
| SK / ZK            | `stats.seelenkraft`, `zaehigkeit`  | Soulpower and toughness                    |
| Interactive Editor | `/character edit`                  | Modal-based stat editing with live updates |

### Talent Probes (3d20 System)

| Feature               | Location             | Details                                  |
| --------------------- | -------------------- | ---------------------------------------- |
| Full Probe Resolution | `/probe`             | 3d20 against 3 attributes                |
| FtW (Fertigkeitswert) | `player_talents.ftw` | Talent skill value                       |
| QS Calculation        | `probe.js`           | Quality Level 1-6 based on remaining FtW |
| Modifiers             | `/probe modifier:`   | +/- modifiers to FtW                     |
| Autocomplete          | `/probe talent:`     | Fuzzy talent search                      |

### Combat System

| Feature             | Location                           | Details                                                                |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| Session Setup       | `/combat start`                    | SETUP phase with join/add mobs                                         |
| Initiative Rolling  | `combatSetupHandler.js`            | 1d6 + base initiative                                                  |
| Turn Order          | `turn_order` array                 | Sorted by initiative, ties by base                                     |
| Attack Resolution   | `combatUtils.js`                   | d20 vs AT with crit/botch                                              |
| Critical Hits       | Natural 1 → confirm roll           | Double damage on confirmed crit                                        |
| Botches             | Natural 20 → confirm roll          | Self-damage on botch                                                   |
| Defender Choice     | `combat_actions`, combat service   | Persisted parry/dodge/decline before damage                            |
| Damage Calculation  | `parseAndRollDamage()`             | Parses "1w6+4" notation                                                |
| Armor Soak          | `applySoak()`                      | RS subtraction, min 1 damage rule                                      |
| Combat Maneuvers    | `action_modifications` table       | AT/PA/damage modifiers                                                 |
| DM NPC Control      | `npcHandler.js`                    | DM controls hostile NPCs                                               |
| Combat Log          | `combat_sessions.combat_log`       | Recent events display                                                  |
| Session Persistence | `recoverActiveCombats()`           | Bot restart recovery                                                   |
| Turn Action Menu    | `combatTurnHandler.js`             | State-aware attacks, actions, casting, resources, and free actions     |
| Pause/Resume        | `/combat pause`, `/combat resume`  | Park and resume active sessions                                        |
| Wounds & Threshold  | `woundUtils.ts`, combat resolution | Aggregate wounds tracked separately from LP; threshold derived from KO |

### Weapons & Equipment

| Feature         | Command(s)                 | Details                    |
| --------------- | -------------------------- | -------------------------- |
| Weapon Creation | `/weapon add`              | Name, type, TP, AT, PA     |
| Weapon Types    | MELEE, RANGED              | Type classification        |
| Equipment Slots | ADAPTIVE, OFFENSE, DEFENSE | DSA 5e slot system         |
| Equip Weapons   | `/weapon equip`            | Interactive slot selection |
| Delete Weapons  | `/weapon delete`           | Remove from inventory      |
| View Weapons    | `/weapon list`             | Categorized display        |

### Inventory System

| Feature        | Command(s)                                          | Details                         |
| -------------- | --------------------------------------------------- | ------------------------------- |
| Item Creation  | `/inventory add`                                    | Name, type, effect, description |
| Item Types     | POTION, FOOD, SCROLL, WEAPON, ARMOR, VALUABLE, MISC | 7 categories                    |
| Item Stacking  | Auto-stacks same name+type                          | Quantity tracking               |
| Use Items      | `/inventory use`                                    | Dice-based effect resolution    |
| Remove Items   | `/inventory remove`                                 | Delete from inventory           |
| View Inventory | `/inventory list`                                   | Grouped by type                 |

`/inv` and `/items` are complete aliases for every `/inventory` subcommand.

### NPC/Mob Templates

| Feature          | Command(s)        | Details                            |
| ---------------- | ----------------- | ---------------------------------- |
| Mob Creation     | `/mob add`        | HP, INI, AT, PA, RS, TP            |
| List Mobs        | `/mob list`       | DM reference                       |
| View Mob Details | `/mob show`       | Full stat block with autocomplete  |
| Edit Mobs        | `/mob edit`       | Update templates with autocomplete |
| Add to Combat    | Setup phase modal | Instantiates from template         |

### Skills/Combat Maneuvers

| Feature          | Command(s)         | Details                            |
| ---------------- | ------------------ | ---------------------------------- |
| Ability Learning | `/advance special` | AP-backed with prerequisite checks |
| View Skills      | `/ability list`    | List learned abilities             |
| Use in Combat    | `/maneuver use`    | Applies AT/PA/damage mods          |

### Utility Commands

| Feature      | Command(s)               | Details                                  |
| ------------ | ------------------------ | ---------------------------------------- |
| Dice Rolling | `/roll`                  | DSA notation (1w20, 3w6+2)               |
| Dice Macros  | `/macro`                 | Save, list, roll, and delete expressions |
| Healing      | `/character restore-lep` | Manual LeP restoration (self or DM)      |
| Evasion      | `/evade-check`           | Standalone d20 vs Ausweichen             |
| Attack Check | `/attack-check`          | Target-free, non-mutating weapon check   |
| Attack Apply | `/attack-resolve`        | Confirmed tracked attack with defense UX |
| Help         | `/help`                  | Command reference                        |

---

## ✅ Committed Roadmap Scope

Priorities 1–3 and Development Sprints 1–5 are implemented and verified. Clean-room migration and integration evidence is tracked in `ROADMAP_PROGRESS.md`.

### Priority 1: Core Mechanics

#### Wound System

- [x] Wound tracking (separate from LP)
- [x] Wound thresholds based on KO
- [x] Wound penalties (-1 to attributes per wound)
- [x] Natural healing rates
- [x] First aid / wound treatment
- [x] Incapacitation at wound limit

#### Status Effects

- [x] Poison (DOT, stat penalties)
- [x] Disease (progressive effects)
- [x] Stun / Paralysis
- [x] Fear / Terror (MU-based checks)
- [x] Exhaustion / Fatigue
- [x] Buff tracking (positive effects)
- [x] Effect duration (rounds)
- [x] Effect tick on turn start/end

#### Combat Options

- [x] Called shots (target body parts)
- [x] Disarm attempts
- [x] Trip / Knockdown
- [x] Grappling
- [x] Two-weapon fighting
- [x] Attacks of opportunity
- [x] Charge attack (bonus damage, movement)
- [x] Full defense stance
- [x] Multiple defense penalty (DSA base -3; -2 with Meisterparade)

### Priority 2: Character Systems

#### Magic System

- [x] `spells` database table and local Regelwiki catalog
- [x] AsP (Astral Points) tracking
- [x] Spell casting probes
- [x] Spell effects (damage, healing, utility)
- [x] Spell schools / traditions
- [x] Spell learning requirements
- [x] Ritual magic support
- [x] Spell duration tracking

#### Karma System

- [x] `liturgies` database table and local Regelwiki catalog
- [x] KaP (Karma Points) tracking
- [x] Blessed actions
- [x] Religious traditions / gods
- [x] Miracle mechanics

#### Character Advancement

- [x] AP (Abenteuerpunkte) tracking and immutable ledger
- [x] DSA AP-purchase progression (DSA has no numeric levels)
- [x] Attribute advancement
- [x] Always-active talents seeded at FW 0
- [x] Raising talent, spell, ritual, liturgy, and ceremony FW values
- [x] Learning spells/liturgies
- [x] Special abilities (Sonderfertigkeiten)

### Priority 3: Equipment & Economy

#### Economy

- [x] Currency tracking (Dukaten, Silbertaler, Heller, Kreuzer)
- [x] Buy/sell commands
- [x] Price lists for items
- [x] Loot distribution
- [x] Trade between players

#### Armor System

- [x] Armor modeled as typed `equipment_catalog` and owned `items` rows
- [x] Armor items with RS and BE (Behinderung)
- [x] Armor slots
- [x] Shield mechanics
- [x] Encumbrance rules
- [x] Carrying capacity

#### Complete Equipment

- [x] Clothing / non-armor equipment
- [x] Equipment weight
- [x] Full slot system (head, body, hands, feet, etc.)

---

## 💡 Nice-to-Have

### Quality of Life

- [x] Character sheet export (PDF/text)
- [x] Dice macros (save common rolls)
- [x] Initiative tracker (non-combat; persistent `/initiative` tracker per server channel)
- [x] Party view (guild-scoped `/party` enrollment and DM overview)
- [x] Quick reference / rule lookups (`/regel`)
- [x] Inline roll results formatting (`[[2w6+3]]` message rolls plus shared compact output)

### Campaign Tools

- [x] Session notes (guild-scoped DM CRUD via `/session-notes`)
- [x] Quest log / objectives (guild-scoped DM CRUD, status, and objective completion)
- [x] NPC generator (quick random NPC identity, motive, personality, and combat stats)
- [x] Random encounter tables (persistent weighted tables and draws)
- [x] Weather / time tracking (persistent world clock, advancement, and generated/manual weather)
- [x] Map linking (named, validated HTTPS campaign maps)

### Advanced Mechanics

- [x] Familiars / companions (selected-character CRUD via `/companion`)
- [x] Mounts / riding animals (typed mount records via `/companion`)
- [x] Strongholds / bases (guild-scoped location, level, status, and notes)
- [x] Crafting system (selected-character projects with bounded progress and completion)
- [x] Reputation / faction standing (DM-managed factions and party-character standing)
- [x] Culture / profession backgrounds (selected-character background profile)
- [x] Alchemy / potion brewing (DM recipe catalog and character brew progress)

### Integration

- [x] Dice So Nice integration (exact custom-roll payloads over signed Foundry webhooks)
- [x] Character import from official tools (validated Foundry DSA5 and Optolith JSON core data)
- [x] Fillable PDF import profile (`DSA5-Dokument V1.93`, preview/confirm, unresolved report)
- [x] API / webhooks (OAuth guild authorization, shared service routes, signed outbound events)
- [x] Backup / restore functionality (bounded campaign JSON with merge and confirmed replace modes)

---

## Database Tables Status

| Table/group                                            | Status    | Usage                                                |
| ------------------------------------------------------ | --------- | ---------------------------------------------------- |
| `players`, `stats`                                     | ✅ Active | Character records, attributes, resources, wounds/AP  |
| `dice_macros`                                          | ✅ Active | Per-character reusable dice expressions              |
| `talents`, `player_talents`                            | ✅ Active | Talent catalog and FW                                |
| `spells`, `player_spells`, `supernatural_*`            | ✅ Active | Magic profiles, learning, castings, and effects      |
| `liturgies`, `player_liturgies`                        | ✅ Active | Karma catalog and learned abilities                  |
| `ap_transactions`                                      | ✅ Active | Immutable AP audit ledger                            |
| `action_modifications`, `player_action_modifications`  | ✅ Active | Maneuvers, prerequisites, AP cost, and ownership     |
| `special_abilities`, `player_special_abilities`        | ✅ Active | Magical/karmic source catalog and learned abilities  |
| `weapons`, `items`, `equipment_catalog`                | ✅ Active | Weapons, armor, clothing, gear, slots, weight/value  |
| `wallets`, `wallet_transactions`                       | ✅ Active | Currency balance and immutable ledger                |
| `trades`, `trade_items`, `loot_pools`, `loot_entries`  | ✅ Active | Atomic trading and post-combat rewards               |
| `mobs`, `combat_sessions`, `combatants`                | ✅ Active | Templates and persistent combat state                |
| `combat_actions`                                       | ✅ Active | Idempotent pending defenses and action journal       |
| `combatant_conditions`, `combatant_statuses`           | ✅ Active | Leveled and binary lifecycle effects                 |
| `combatant_effects`, `wound_treatments`                | ✅ Active | Buff/debuff state and treatment audit                |
| `party_memberships`, `initiative_trackers`             | ✅ Active | Guild party enrollment and scene initiative          |
| `session_notes`, `campaign_records`, `campaign_worlds` | ✅ Active | Notes, quests, encounters, maps, bases, world state  |
| `character_records`                                    | ✅ Active | Companions, backgrounds, standing, crafting, alchemy |
| `webhook_subscriptions`                                | ✅ Active | Signed outbound integrations and Dice So Nice events |

---

## Delivered Development Sprints

### Sprint 1: Combat Completeness

1. ✅ Status effects system
2. ✅ Multiple defense penalties
3. ✅ Combat options (disarm, trip, and the committed extended set)

### Sprint 2: Wounds & Healing

1. ✅ Wound tracking
2. ✅ Wound penalties
3. ✅ First aid mechanics

### Sprint 3: Magic

1. ✅ Spells database and catalog
2. ✅ AsP tracking
3. ✅ Spell casting, rituals, duration, and typed effects

### Sprint 4: Economy & Equipment

1. ✅ Currency system
2. ✅ Armor and complete equipment
3. ✅ Trading and loot commands

### Sprint 5: Advancement

1. ✅ AP tracking and ledger
2. ✅ Rules-based AP purchase mechanics
3. ✅ Attribute, talent, supernatural FW, and special-ability improvement

---

_Last updated: August 2026_
