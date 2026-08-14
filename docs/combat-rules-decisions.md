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

- Every defense attempt increments a persisted counter. Later defenses in the
  same round receive -3 each; learned Meisterparade changes the step to -2.
  Counters reset together at the round boundary.
- Verteidigungshaltung spends the active action, grants +4 PA, blocks further
  actions, and expires at the user's next turn start.
- Entwaffnen drops an eligible equipped player weapon. Zu Fall bringen observes
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
  combat technique. Defaults are 10/50/100 and one reload action. Range penalties
  are 0/-2/-4, cover is an additional validated penalty from 0 through 4, and an
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
and the combat log survive bot restart. The latest active or ended log for a
channel is available through `/combat log` and the combat API. The database is
the source of truth; the Discord in-memory mirror is refreshed after turn
transitions rather than owning transient mechanics.
