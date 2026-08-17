# Combat and Effect Rules Decisions

This document records the implementation choices that connect the local DSA
references to DSANewBot's persisted combat model. The detailed source tables
remain in `combat-maneuvers-reference.md`, `additional-combat-maneuvers.md`,
`conditions-reference.md`, `status-effects-reference.md`, and
`wound-system-rules.md`.

## Effect lifecycle

- Leveled conditions, binary statuses, and numeric buffs/debuffs are stored in
  separate tables. Conditions and pain contribute a combined check penalty
  capped at 5. A level-IV condition, eight total condition levels, Pain IV, or
  a direct incapacitation status blocks actions and defenses.
- Ongoing status damage is applied at the affected combatant's turn end. A
  finite status and a round-based condition also lose one round then. Numeric
  effects and stances expire at the affected combatant's next turn start.
- Poison, fire, bleeding, and disease use the same typed status payload. A
  disease can increase its damage after each tick with
  `damageProgressionPerRound`, capped by `maxDamagePerRound`. This models the
  source-specific progression described by the reference without hard-coding a
  single disease.
- Rest-duration conditions are removed by a completed regeneration phase.
  Überanstrengung II applies -1 and Überanstrengung III applies -2 to LeP, AsP,
  and KaP regeneration before that recovery.
- Only the combat DM may author or remove conditions, statuses, and generic
  effects. The affected player or DM may roll the explicit Furcht resistance
  action.

## Defense and maneuvers

- A successful normal attack pauses before damage and offers the defender each
  legal choice. Melee attacks may be parried or dodged; ranged attacks may be
  dodged or parried with a shield. Shooting defenses receive -4 and thrown
  weapon defenses -2. Critical successes and opportunity attacks are
  unopposed. Declining a defense never increments the defense counter.
- Against a large attacker, only shield parry or dodge is offered; against a
  huge attacker, only dodge is offered. Attacks against tiny targets receive
  the core -4 AT size modifier.
- Every attempted parry or dodge increments a persisted counter. Later defenses in the
  same round receive -3 each; learned Meisterparade changes the step to -2.
  Counters reset together at the round boundary.
- Verteidigungshaltung must be the combatant's first declaration on its active
  turn. It is no longer offered after an action or free action, spends the
  action, grants +4 PA, blocks further actions, and expires at the combatant's
  next turn start. This is the persisted turn-boundary approximation used by
  the bot for the core rule's "beginning of the combat round" timing.
- Entwaffnen uses AT -4 (-6 against a two-handed weapon), deals 1W3 TP, excludes
  shields, and persists the dropped weapon until it is retrieved. Zu Fall bringen observes
  size restrictions and applies Liegend. Haltegriff applies Fixiert and
  Eingeengt while preventing the grappler from defending; the held character
  can spend an action on the KK escape check. A prone character can spend an
  action to stand.
- Sturmangriff requires a declared running distance from 4 steps through the
  attacker's GS. It uses AT -2 and gains `2 + floor(GS / 2)` TP, capped at +10.
  A normal miss grants the defender one unopposed Passierschlag at AT -4. That
  reaction is consumed on use and otherwise expires at the next round boundary,
  so it remains available when the defender's turn begins immediately after the
  failed charge.

## Two-weapon fighting

- The action requires distinct equipped one-handed melee weapons. It makes two
  separate attacks and permits one or two targets; defenses are resolved and
  counted independently. A botch on the first attack cancels the second.
- The base modifier is -2 to each hand. Beidhändiger Kampf I changes the base to
  -1 and level II to 0. The off hand also receives the documented -4 wrong-hand
  penalty. The Beidhändig advantage is not represented in the current character
  model, so that exception is not silently assumed.
- Compound attacks currently accept only their dedicated action, not another
  maneuver, matching the reference restriction to compatible Basismanöver until
  maneuver categories are represented explicitly.

## Ranged attacks and hit zones

- Ranged weapons persist close/medium/far ranges, reload actions, hand use, and
  combat technique. Defaults are 10/50/100 and one reload action. Close range is
  +2 AT/+1 TP, medium is unchanged, and far range is -2 AT/-1 TP. Cover is an additional validated penalty from 0 through 4, and an
  attack sets the weapon's reload counter after it fires.
- Maneuver prerequisites validate attributes, free hands, combat value, learned
  prerequisite abilities, weapon action type, and combat technique. Mob attacks
  use Raufen because mob templates do not yet carry weapon inventories.
- Random locations and called shots use the humanoid small/medium/large tables.
  Called-shot penalties are head -10, torso -4, limbs -8; Gezielter Angriff or
  Gezielter Schuss halves the penalty and Überraschung reduces it by 2.
- A wound to the head, arm, or leg triggers one Selbstbeherrschung
  (MU/MU/KO) resistance roll for a player target. Failure applies Betäubung,
  disarm, or Liegend respectively. Torso wounds add 1W3+1 SP. NPC templates do
  not contain attributes or talents, so their wound effect is applied without a
  resistance roll and is reported as not attempted.

## Persistence and recovery

Combat sessions, defense/reload state, hit location, all three effect classes,
pending attacks, action-use records, dropped equipment, and the combat log
survive bot restart. The latest active or ended log for a
channel is available through `/combat log` and the combat API. The database is
the source of truth; the Discord in-memory mirror is refreshed after turn
transitions rather than owning transient mechanics.

## Rules parity matrix

| Area                     | Implemented contract                                                           | Authority               |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------- |
| Melee defense            | Defender chooses weapon/shield parry, dodge, or decline                        | Core                    |
| Ranged defense           | Dodge or shield parry; -4 shooting, -2 thrown                                  | Core                    |
| Creature size            | Large: shield/dodge; huge: dodge only; tiny targets: -4 AT                     | Core                    |
| Critical attack          | No defense; damage is doubled                                                  | Core                    |
| Multiple defenses        | One shared counter; -3 per prior attempt, -2 with Meisterparade                | Core / optional ability |
| Incapacitation           | Level-IV/direct action or defense prohibition removes choices                  | Core                    |
| Longer actions           | A chosen defense explicitly interrupts the persisted longer action             | Core                    |
| Maneuver compatibility   | Weapon type, technique, prerequisites, and base/special category are validated | Core                    |
| NPC defenses             | No artificial per-round cap; DM chooses from the same legal options            | DSANewBot house rule    |
| Opportunity attack       | AT -4 and no defense                                                           | Core                    |
| Free-action descriptions | One bounded free-action record per turn                                        | DSANewBot house rule    |

The NPC defense limit remains intentionally uncapped because the current mob
catalog has no creature-specific defense allowance. `NPC_DEFENSE_LIMIT` remains
a stable rule-engine reason for a future per-creature limit; treating all NPCs
as having one defense would be an undocumented rules invention.

Primary size reference: [DSA Regelwiki — Größenkategorie](https://dsa.ulisses-regelwiki.de/Spezielle_Nahkampfregeln/groessenkategorie.html).
