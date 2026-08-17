# DSA 5e Wound & Hit Location Rules

Reference for implementing the wound system in DSANewBot.

---

## Pain (Schmerz) - Core System

Pain is triggered by Life Point thresholds and other effects.

### Pain Thresholds

#### Stufe I

- trigger: LP at or below 75% of maximum
- test penalty: All tests -1
- speed penalty: GS -1

#### Stufe II

- trigger: LP at or below 50% of maximum
- test penalty: All tests -2
- speed penalty: GS -2

#### Stufe III

- trigger: LP at or below 25% of maximum
- test penalty: All tests -3
- speed penalty: GS -3

#### Stufe IV

- trigger: LP at or below 5
- test penalty: All tests -4
- special: **Incapacitated** (Handlungsunfähig) unless Selbstbeherrschung check passed

### Pain Recovery

- natural recovery: Lose 1 level per 4 hours (unless otherwise stated)
- level IV check: Must pass `Selbstbeherrschung (Handlungsfähigkeit bewahren)` check to remain capable of action

### Implementation Notes

- pain level: Derived from current LP, not stored separately
- recalculate: Whenever LP changes
- GS meaning: Geschwindigkeit (Movement Speed)

---

## Wound Threshold (Wundschwelle) - Focus Rule

This is a Fokusregel (optional rule) used with the Hit Location system.

### Formula

```
Wundschwelle = KO ÷ 2 (half of Constitution, rounded down)
```

### Trait Modifiers

| Trait   | Type                    | Effect          |
| ------- | ----------------------- | --------------- |
| Eisern  | Advantage (Vorteil)     | +1 Wundschwelle |
| Gläsern | Disadvantage (Nachteil) | -1 Wundschwelle |

**Modified Formula:**

```
Wundschwelle = floor(KO / 2) + eisern_bonus + gläsern_penalty
```

**Example:** A character with KO 14 and Eisern advantage has Wundschwelle 8 (7 + 1).

### Wound Effects Trigger

When damage equals or exceeds the Wundschwelle:

#### 1× Threshold

- difficulty modifier: +1

#### 2× Threshold

- difficulty modifier: +2

#### 3× Threshold

- difficulty modifier: +3

### Effects by Hit Zone

#### Kopf (Head)

- wound effect: 1 level of Betäubung (Stun)
- resist check: Selbstbeherrschung (Handlungsfähigkeit bewahren)

#### Torso

- wound effect: Additional 1W3+1 SP
- resist check: Selbstbeherrschung (Handlungsfähigkeit bewahren)

#### Arme (Arms)

- wound effect: Drop held object (one-handed weapons/items fall; two-handed weapons and shields unaffected)
- resist check: Selbstbeherrschung (Störungen ignorieren)

#### Beine (Legs)

- wound effect: Fall prone (Status: Liegend)
- resist check: Selbstbeherrschung (Störungen ignorieren)

**Important:** Only one resistance check needed regardless of how many wound effects were inflicted.

---

## Hit Location (Trefferzonen) - Focus Rule

Hit location rules are a **Focus Rule Level I** for combat. They add consequences for being hit in different body parts.

### Hit Location Procedure

1. Execute an attack (Attacke or Fernkampfangriff)
2. If successful, the target may use a defense
3. If defense fails, roll **1W20** to determine which body part is hit
4. Apply damage and any wound effects based on location

### Hit Location Tables

#### Humanoid Creatures

##### Small

- head (Kopf): 1-6
- torso: 7-10
- arms: 11-18
- legs: 19-20

##### Medium

- head (Kopf): 1-2
- torso: 3-12
- arms: 13-16
- legs: 17-20

##### Large

- head (Kopf): 1-2
- torso: 3-6
- arms: 7-16
- legs: 17-20

**Left/Right determination:** Even roll = right side, Odd roll = left side

#### Four-legged, Small (e.g., Goat)

- head: 1-4
- torso: 5-12
- front legs: 13-16
- hind legs: 17-20

#### Four-legged, Medium (e.g., Wolf)

- head: 1-4
- torso: 5-10
- front legs: 11-16
- hind legs: 17-20

#### Four-legged, Large (e.g., Cattle)

- head: 1-5
- torso: 6-11
- front legs: 12-16
- hind legs: 17-20

#### Six Limbs + Tail, Large (e.g., Tatzelwurm)

- head: 1-4
- torso: 5-12
- front limbs: 13-14
- middle limbs (legs/wings): 15-16
- hind limbs: 17-18
- tail: 19-20

#### Six Limbs + Tail, Huge (e.g., Dragon)

- head: 1-2
- torso: 3-10
- front limbs: 11-14
- middle limbs (legs/wings): 15-16
- hind limbs: 17-18
- tail: 19-20

#### Tentacled, Medium to Huge (e.g., Krakenmolch)

- torso: 1-2
- head: 3-6
- tentacles: Rest (distributed evenly among tentacles, overflow to Torso)

#### No Distinct Zones (e.g., Giant Amoeba)

- body: 1-20

### Creature Size Categories

For reference when determining hit zones:

- small: Halflings, goblins, small animals
- medium: Humans, elves, dwarves, wolves
- large: Ogres, horses, bears

---

## Called Shots (Gezielte Angriffe)

### Modifiers for Targeting Hit Zones (Humanoid, Small to Large)

#### Head

- modifier: -10 AT or FK

#### Torso

- modifier: -4 AT or FK

#### Arms

- modifier: -8 AT or FK

#### Legs

- modifier: -8 AT or FK

### Modifier Reductions

#### Target is Überrascht (Surprised)

- effect: All zone penalties reduced by 2

#### Attacker has Gezielter Angriff (melee)

- effect: Penalties halved

#### Attacker has Gezielter Schuss (ranged)

- effect: Penalties halved

> **Note:** These modifiers replace the size category modifiers from the core rules.

### Special Abilities for Called Shots

#### Gezielter Angriff (Targeted Attack - Melee)

- type: Special Maneuver (Fokusregel Stufe I)
- requirement: GE 13
- AP cost: 10
- applicable: All melee techniques
- effect: Allows called shots to hit zones with halved penalties

#### Gezielter Schuss (Targeted Shot - Ranged)

- type: Special Maneuver (Fokusregel Stufe I)
- requirement: FF 13
- AP cost: 10
- applicable: All ranged techniques
- effect: Allows called shots to hit zones with halved penalties

### Targeting Sensitive Spots

Some creatures have particularly vulnerable areas that can be targeted:

- knowledge required: Must succeed at a Tierkunde (Animal Lore) check to know about the weak spot
- penalties range: -2 to -8 depending on size and accessibility
- effect: Normal damage PLUS special creature-specific effects

---

---

## Tiefe Wunde (Deep Wound) - Special Maneuver

A combat maneuver that causes the bleeding status.

- type: Special Maneuver (Attacke)
- modifier: -2 AT
- requirement: Must inflict at least 1 SP damage
- effect: Target acquires Blutend (Bleeding) status

### Procedure

1. Attacker declares Tiefe Wunde maneuver
2. Attack is made at -2 AT penalty
3. If attack succeeds and defense fails:
    - Damage is calculated normally
    - If at least 1 SP is inflicted, target must make Selbstbeherrschung check
    - On failed check, target gains Blutend status for `7 - QS` combat rounds

### Notes

- weapon requirement: Bladed or piercing weapon
- combination: Can be combined with called shots for additional effects
- stacking: Multiple applications refresh duration but don't stack

---

## Bleeding (Blutend) - Status Effect

Acquired through deep wounds or critical hits.

### Triggers

- deep wounds: Critical hits
- tiefe wunde maneuver:
    - attack modifier: -2 AT
    - requirement: Must inflict at least 1 SP damage
    - effect: Causes bleeding status on target
- certain weapons: e.g., Blutiger Zweihänder - Bloody Two-Hander

### On Acquisition

- check required: Selbstbeherrschung check required when bleeding starts
- duration: `7 - QS` combat rounds (CR)
    - patzer (Fumble): Duration doubled
    - critical success: Bleeding stops immediately

### Effect

- damage: 1 SP at the end of each combat round while bleeding

### Treatment

- skill: Heilkunde Wunden check at +2 bonus
- time: 1 Action
- reduction: Reduces remaining rounds by `QS ÷ 2` (rounded down)

### Stacking Rules

- stacking: Cannot stack - only the longer duration applies
- reapplication: If acquired again while bleeding, make a new Selbstbeherrschung check
- tracking: Only the longest duration is tracked

### Related Talent Checks

- selbstbeherrschung (Störungen ignorieren): May be used to resist bleeding effects
- hart im Nehmen (Tough): +1 bonus on Selbstbeherrschung checks for wound effects
- verweichlicht (Soft): +2 penalty on Selbstbeherrschung checks for wound effects

---

## Wundfieber (Wound Fever) - Disease

A disease caused by untreated or poorly treated wounds.

- stufe: 5
- widerstand: Zähigkeit (Toughness)
- inkubationszeit: 1 day
- dauer: 3 days

### Damage

- day 1: 2 levels Verwirrung (or 1 level)
- day 2+: 2 levels Betäubung + 1W6 SP/day (or 1 level + 1W3 SP/day)

### Causes

- bites: From scavengers
- contaminated weapons: Attacks with heavily contaminated weapons
- poor wound care: No or poor treatment (1-2 on W20 = 10% chance)

### Treatment

- bed rest: Reduces damage by 1 SP/day
- antidote: No antidote; Peraine church has liturgies to stop it

---

## Special Injuries (Fokusregel)

### Amputation

- cause: Wound fever with a rolled 1 for cause determination
- effect: 1W3 SP/day, Status Krank, 1-4 levels of Stun/Pain/Confusion
- check: Heilkunde Wunden (Amputieren) +0 to -6
    - success: 2W6 SP, limb removed (gain Verstümmelt disadvantage)
    - failure: 6W6 SP, 50% chance of Wound Fever

### Bone Fractures

- cause: 15+ TP from blunt weapons, falls, etc. (1-2 on W20 = 10%)
- effect: Limb unusable, possible -2 GS, 1-2 levels Pain
- check: Heilkunde Wunden (Knochenbrüche) +0 to -6
    - success: 1W3-1 SP (Trümmerbruch: +1W6 SP)
    - failure: 1W6+1 SP, 20% Wound Fever (open fracture)

### Severe Burns

- cause: Fire, cold, acid (1-2 to 1-10 on W20 depending on area)
- effect: Disadvantage Hässlich I (temporary), 1-3 levels Pain
- check: Heilkunde Wunden (Verbrennungen) -2 to -4
    - failure: 1W6 days of 1W3 SP each

### Chirurgischer Eingriff (Surgery)

- cause: 20+ SP from single attack (1 on W20 = 5%), diseases, poisons
- effect: Damaged organ causes 1W6 SP/day (double for vital organs)
- check: Heilkunde Wunden (Chirurgie) -5 to -11
    - success: 3W6+6 SP, 10% Wound Fever
    - failure: 6W6+12 SP, 75% Wundfieber

---

## Death & Stabilization

### Death Thresholds

- LeP = 0 or below: Death threatens
- treatment window: Must receive treatment within KO (Constitution) combat rounds or die
- LeP ≤ -KO: Instant death

### Stabilization

- check: Heilkunde Wunden (Stabilisieren)
- difficulty: Penalty = half of negative LeP (rounded down)
    - example: At -6 LeP, difficulty is -3
- time: ~15 minutes
- success: LeP rises to 1

---

## DSANewBot Aggregate-Wound Profile

The product roadmap commits an aggregate wound counter rather than the full hit-location focus system. The following bridge rules are deliberate so the counter has consistent effects without pretending that zone-specific injuries are implemented:

- A damage event inflicts one wound for every full wound threshold reached, capped at three wounds from one hit. Wounds accumulate independently from LeP.
- Every accumulated wound applies `-1` to AT, PA, and each of the three attributes used by a talent probe. The applied penalty is capped at `-3`.
- At three wounds, a combatant is incapacitated: they cannot attack or defend until at least one wound heals.
- One aggregate wound heals after every completed regeneration phase. This is the natural-healing cadence for the aggregate model; hit-zone recovery times are not inferred.
- `Heilung fördern` stores its LeP bonus for the next regeneration phase instead of healing immediately. Only the highest pending bonus is retained, preventing repeated treatment from stacking.
- `Schmerzen nehmen` suppresses at most four Schmerz levels. A normal success lasts through the next regeneration phase; a critical success lasts through two phases. A fumble adds one temporary Schmerz level until regeneration.
- Failed stabilization attempts add the documented cumulative `-1` retry penalty. Success sets LeP to 1 and clears the retry counter. Targets at or below `-KO` cannot be stabilized.
- LeP may become negative so stabilization rules are reachable. This replaces the earlier zero-floor behavior in combat damage.
- Treatment applications are audited in `wound_treatments`; Discord and HTTP use the same authorization and business-rule service.

Hit locations, resistance checks, called shots, and special injuries remain separate focus-rule work and are not implied by the aggregate counter.

---

## Implementation Checklist

### Phase 1: Pain System

- [x] Add pain level calculation based on LP thresholds
- [ ] Apply pain penalties to all checks
- [ ] Apply GS reduction from pain
- [ ] Handle incapacitation at Pain Stufe IV

### Phase 2: Wound Threshold

- [x] Add Wundschwelle field to stats (KO ÷ 2)
- [x] Add an explicit Wundschwelle modifier field (Eisern +1, Gläsern -1)
- [ ] Look up character advantages/disadvantages for Wundschwelle calculation
- [x] Track damage against wound threshold in combat
- [x] Apply aggregate wound penalties, natural recovery, and incapacitation
- [ ] Implement Selbstbeherrschung resistance checks
- [ ] Apply wound effects by hit zone

### Phase 3: Hit Locations

- [ ] Add hit zone roll after successful attack
- [ ] Store creature size category (small/medium/large)
- [ ] Implement hit location tables
- [ ] Track hit zone for wound effects

### Phase 4: Called Shots

- [ ] Add called shot option to attacks
- [ ] Apply AT/FK modifiers by zone
- [ ] Check for Gezielter Angriff/Schuss abilities
- [ ] Halve penalties for characters with special abilities

### Phase 5: Bleeding Status

- [x] Add Blutend status effect
- [ ] Track duration in combat rounds
- [ ] Apply 1 SP at end of each round
- [x] Implement Heilkunde Wunden treatment (see `heilkunde-wunden.md`)

### Phase 5.5: Wound Treatment

- [x] Add Heilung fördern (promote healing) application
- [x] Add Schmerzen nehmen (remove pain) application
- [x] Add Stabilisieren (stabilize) for dying characters
- [x] Add bleeding treatment mechanics

### Phase 6: Special Injuries (Optional)

- [ ] Bone fracture system
- [ ] Amputation tracking
- [ ] Burn effects
- [ ] Surgery mechanics

---

## Database Schema Additions

### stats table additions

```sql
-- Pain/Wound fields
ALTER TABLE stats ADD COLUMN wundschwelle INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN pain_level INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_head INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_torso INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_left_arm INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_right_arm INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_left_leg INTEGER DEFAULT 0;
ALTER TABLE stats ADD COLUMN wounds_right_leg INTEGER DEFAULT 0;
```

### status_effects table (new)

```sql
CREATE TABLE status_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combatant_id UUID REFERENCES combatants(id) ON DELETE CASCADE,
    effect_type VARCHAR(50) NOT NULL, -- 'bleeding', 'stun', 'prone', 'pain', etc.
    level INTEGER DEFAULT 1, -- for stackable effects
    duration_rounds INTEGER, -- null = permanent until removed
    source VARCHAR(100), -- what caused this effect
    created_at TIMESTAMP DEFAULT NOW()
);
```

### combatants table additions

```sql
ALTER TABLE combatants ADD COLUMN hit_zone VARCHAR(20); -- last hit location
ALTER TABLE combatants ADD COLUMN creature_size VARCHAR(20) DEFAULT 'medium'; -- small/medium/large
```

---

_Source: https://dsa.ulisses-regelwiki.de/Sta_Schmerz.html_
_Source: https://dsa.ulisses-regelwiki.de/Fokus_TrefferzonenRegeln.html_
_Source: https://dsa.ulisses-regelwiki.de/GR_Status.html_
_Source: https://dsa.ulisses-regelwiki.de/TA_Selbstbeherrschung.html_
_Source: https://dsa.ulisses-regelwiki.de/vorteil.html?vorteil=Eisern_
_Source: https://dsa.ulisses-regelwiki.de/nachteil.html?nachteil=Gläsern_

**See also:** `heilkunde-wunden.md` for wound treatment mechanics
