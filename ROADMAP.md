# DSANewBot Roadmap

Feature audit and development roadmap for becoming a complete DSA 5th Edition tabletop companion.

---

## ✅ Implemented Features

### Character Management

| Feature             | Command(s)          | Details                                       |
| ------------------- | ------------------- | --------------------------------------------- |
| Character Creation  | `/create-character` | Creates player with name                      |
| Character Selection | `/choose-character` | Multi-character support per Discord user      |
| Character Deletion  | `/delete-character` | Remove characters                             |
| Avatar Upload       | `/upload-avatar`    | Custom character portraits (Supabase storage) |

### Attributes & Stats

| Feature            | Location                           | Details                                    |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| 8 Core Attributes  | `stats` table                      | MU, KL, IN, CH, FF, GE, KO, KK             |
| Life Points (LP)   | `stats.le_max`, `stats.le_current` | Current/max tracking                       |
| Initiative         | `stats.initiative`                 | Base initiative value                      |
| Armor Soak (RS)    | `stats.ruestungsschutz`            | Natural plus equipped armor, synchronized  |
| Dodge (Ausweichen) | `stats.ausweichen`                 | Evasion value                              |
| Interactive Editor | `/edit-stats`                      | Modal-based stat editing with live updates |

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
| Session Setup       | `/start-combat`                    | SETUP phase with join/add mobs                                         |
| Initiative Rolling  | `combatSetupHandler.js`            | 1d6 + base initiative                                                  |
| Turn Order          | `turn_order` array                 | Sorted by initiative, ties by base                                     |
| Attack Resolution   | `combatUtils.js`                   | d20 vs AT with crit/botch                                              |
| Critical Hits       | Natural 1 → confirm roll           | Double damage on confirmed crit                                        |
| Botches             | Natural 20 → confirm roll          | Self-damage on botch                                                   |
| Defense/Parry       | `combatUtils.js`                   | d20 vs PA after hit                                                    |
| Damage Calculation  | `parseAndRollDamage()`             | Parses "1w6+4" notation                                                |
| Armor Soak          | `applySoak()`                      | RS subtraction, min 1 damage rule                                      |
| Combat Maneuvers    | `action_modifications` table       | AT/PA/damage modifiers                                                 |
| DM NPC Control      | `npcHandler.js`                    | DM controls hostile NPCs                                               |
| Combat Log          | `combat_sessions.combat_log`       | Recent events display                                                  |
| Session Persistence | `recoverActiveCombats()`           | Bot restart recovery                                                   |
| Pause/Resume        | `/park-combat`, `/resume-combat`   | Park active sessions                                                   |
| Wounds & Threshold  | `woundUtils.ts`, combat resolution | Aggregate wounds tracked separately from LP; threshold derived from KO |

### Weapons & Equipment

| Feature         | Command(s)                 | Details                    |
| --------------- | -------------------------- | -------------------------- |
| Weapon Creation | `/add-weapon`              | Name, type, TP, AT, PA     |
| Weapon Types    | MELEE, RANGED              | Type classification        |
| Equipment Slots | ADAPTIVE, OFFENSE, DEFENSE | DSA 5e slot system         |
| Equip Weapons   | `/equip-weapon`            | Interactive slot selection |
| Delete Weapons  | `/delete-weapon`           | Remove from inventory      |
| View Weapons    | `/show-weapons`            | Categorized display        |

### Inventory System

| Feature        | Command(s)                                          | Details                         |
| -------------- | --------------------------------------------------- | ------------------------------- |
| Item Creation  | `/add-item`                                         | Name, type, effect, description |
| Item Types     | POTION, FOOD, SCROLL, WEAPON, ARMOR, VALUABLE, MISC | 7 categories                    |
| Item Stacking  | Auto-stacks same name+type                          | Quantity tracking               |
| Use Items      | `/use-item`                                         | Dice-based effect resolution    |
| Remove Items   | `/remove-item`                                      | Delete from inventory           |
| View Inventory | `/show-items`                                       | Grouped by type                 |

### NPC/Mob Templates

| Feature          | Command(s)        | Details                            |
| ---------------- | ----------------- | ---------------------------------- |
| Mob Creation     | `/add-mob`        | HP, INI, AT, PA, RS, TP            |
| List Mobs        | `/list-mobs`      | DM reference                       |
| View Mob Details | `/show-mob`       | Full stat block with autocomplete  |
| Edit Mobs        | `/edit-mob`       | Update templates with autocomplete |
| Add to Combat    | Setup phase modal | Instantiates from template         |

### Skills/Combat Maneuvers

| Feature          | Command(s)                         | Details                            |
| ---------------- | ---------------------------------- | ---------------------------------- |
| Ability Learning | `/advance special`, `/edit-skills` | AP-backed with prerequisite checks |
| View Skills      | `/show-skills`                     | List learned maneuvers             |
| Use in Combat    | `/use-skill`                       | Applies AT/PA/damage mods          |

### Utility Commands

| Feature      | Command(s) | Details                                 |
| ------------ | ---------- | --------------------------------------- |
| Dice Rolling | `/roll`    | DSA notation (1w20, 3w6+2)              |
| Healing      | `/heal`    | HP restoration (self or DM heal others) |
| Evasion      | `/evade`   | d20 vs Ausweichen                       |
| Help         | `/help`    | Command reference                       |

---

## ✅ Committed Roadmap Scope

Priorities 1–3 and Development Sprints 1–5 are implemented in the repository. Clean local migration and live integration verification are externally blocked by the unavailable container runtime; evidence and the precise remaining verification work are tracked in `ROADMAP_PROGRESS.md`.

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

- [ ] Character sheet export (PDF/text)
- [ ] Dice macros (save common rolls)
- [ ] Initiative tracker (non-combat)
- [ ] Party view (DM overview of all players)
- [x] Quick reference / rule lookups (`/regel`)
- [ ] Inline roll results formatting

### Campaign Tools

- [ ] Session notes (DM)
- [ ] Quest log / objectives
- [ ] NPC generator (quick random NPCs)
- [ ] Random encounter tables
- [ ] Weather / time tracking
- [ ] Map linking

### Advanced Mechanics

- [ ] Familiars / companions
- [ ] Mounts / riding animals
- [ ] Strongholds / bases
- [ ] Crafting system
- [ ] Reputation / faction standing
- [ ] Culture / profession backgrounds
- [ ] Alchemy / potion brewing

### Integration

- [ ] Dice So Nice integration (animated dice)
- [ ] Character import from official tools
- [ ] API / webhooks
- [ ] Backup / restore functionality

---

## Database Tables Status

| Table/group                                           | Status    | Usage                                               |
| ----------------------------------------------------- | --------- | --------------------------------------------------- |
| `players`, `stats`                                    | ✅ Active | Character records, attributes, resources, wounds/AP |
| `talents`, `player_talents`                           | ✅ Active | Talent catalog and FW                               |
| `spells`, `player_spells`, `supernatural_*`           | ✅ Active | Magic profiles, learning, castings, and effects     |
| `liturgies`, `player_liturgies`                       | ✅ Active | Karma catalog and learned abilities                 |
| `ap_transactions`                                     | ✅ Active | Immutable AP audit ledger                           |
| `action_modifications`, `player_action_modifications` | ✅ Active | Maneuvers, prerequisites, AP cost, and ownership    |
| `special_abilities`, `player_special_abilities`       | ✅ Active | Magical/karmic source catalog and learned abilities |
| `weapons`, `items`, `equipment_catalog`               | ✅ Active | Weapons, armor, clothing, gear, slots, weight/value |
| `wallets`, `wallet_transactions`                      | ✅ Active | Currency balance and immutable ledger               |
| `trades`, `trade_items`, `loot_pools`, `loot_entries` | ✅ Active | Atomic trading and post-combat rewards              |
| `mobs`, `combat_sessions`, `combatants`               | ✅ Active | Templates and persistent combat state               |
| `combatant_conditions`, `combatant_statuses`          | ✅ Active | Leveled and binary lifecycle effects                |
| `combatant_effects`, `wound_treatments`               | ✅ Active | Buff/debuff state and treatment audit               |

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
