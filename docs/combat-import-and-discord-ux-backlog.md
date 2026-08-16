# Combat, Character Import, and Discord UX Backlog

This is an implementation backlog for the changes discussed in August 2026. It
does not mark any feature as complete and does not replace `ROADMAP.md`. The
items are ordered so they can be implemented and verified in bounded slices.

## Goals

- Make an attack check usable without selecting or damaging a Discord user.
- Make defense an explicit, rules-aware choice instead of an automatic parry.
- Expose the combat actions and resource systems that already exist behind a
  coherent in-combat action menu.
- Correct known DSA 5 rule mismatches while preserving documented house rules.
- Let safe informational commands be shown publicly when requested.
- Import the campaign's fillable DSA character PDF through a reusable sheet
  profile, without hard-coding one character or campaign.
- Improve Discord presentation with a tested native layout system rather than
  applying more decoration to every embed.

## Current baseline

The codebase already contains more combat support than the current combat panel
reveals. This backlog should reuse it instead of rebuilding it.

| Area                 | Current behavior                                                                                                                                                                                                                           | Main touchpoints                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Standalone attack    | `/attack-check` delegates to a full target resolution: a Discord user is required, defense is automatic, and HP/wounds can be changed.                                                                                                     | `commands/attack-check.js`, `commands/attack.js`                                                                                    |
| Tracked attack       | A successful attack immediately rolls PA and applies damage in one service call.                                                                                                                                                           | `services/combat.ts`, `handlers/combatTurnHandler.js`                                                                               |
| Combat panel         | The active player sees only **Attack**, **Skill/Action**, and **End Turn**. Skill/Action lists learned melee maneuvers only.                                                                                                               | `handlers/combatTurnHandler.js`                                                                                                     |
| Other combat actions | Full defense, reload, escape grapple, stand up, two-weapon attacks, opportunity attacks, disarm, trip, grapple, ranged attacks, and hit zones exist in services/API or `/combat-action`. They are not presented as one coherent turn flow. | `commands/combat-action.js`, `services/combat.ts`, `api/routes/combat.ts`                                                           |
| Resources/casting    | AsP and KaP can be spent through their own commands. Spell/liturgy execution spends resources and can advance tracked combat, but these actions are not discoverable from the combat panel.                                                | `commands/asp.js`, `commands/kap.js`, `commands/spells.js`, `commands/liturgies.js`, `services/supernatural.ts`                     |
| Visibility           | Spell, liturgy, ability, and maneuver display commands always defer ephemerally. Other commands already demonstrate a `visible` option.                                                                                                    | `commands/spells.js`, `commands/liturgies.js`, `commands/show-skills.js`, `commands/show-maneuver.js`, `commands/list-maneuvers.js` |
| Character import     | JSON only, limited to 2 MB, supporting DSANewBot, Foundry DSA5, and Optolith core fields. Unknown data is ignored and creation is compensated with a delete rather than one transaction.                                                   | `commands/import-character.js`, `utils/characterImport.ts`, `services/characterRecords.ts`                                          |
| Presentation         | Runtime embeds use shared builders and limit checks, but the product still relies on legacy embeds for almost every substantial view.                                                                                                      | `utils/embedUtils.js`, `utils/embedViews.js`, `docs/discord-embed-style.md`                                                         |

## Confirmed DSA 5 constraints

These are the initial rules baseline. Each implementation must link its behavior
to the exact Regelwiki entry or to an explicitly named house rule.

- A normal combat round distinguishes an **action**, one or more
  **defenses**, and a **free action**. Attacks, spells, liturgies, movement,
  reloading, manipulating an object, and other non-attack activity can all use
  the action slot.
- After a successful attack, the defender chooses whether and how to defend.
  Parade and dodge are alternatives; only one defense attempt may answer a
  given attack.
- A defender may decide after the attack roll whether to defend during a
  longer-running action. Defending then interrupts that longer action.
- Defense eligibility depends on the attack and current state. For example, a
  normal weapon cannot parry a ranged attack; dodge or shield parry may be
  available with the relevant modifiers. Some attacks and statuses prohibit
  defense entirely.
- Later defenses in the same round inherit the cumulative defense penalty even
  when the defender switches between parade and dodge.
- `Entwaffnen` is not ordinary weapon damage followed by unequipping: the
  official maneuver has its own AT penalty, two-handed adjustment, defense,
  1W3 TP, and shield exclusion. Picking up a dropped item is a separate action.
- `Verteidigungshaltung` must be declared at the beginning of the round and
  prevents actions for that round; it is not merely an action selectable at any
  point in the turn.

Known code/rule mismatches to include in the first audit are automatic PA,
absence of dodge selection, ranged defense eligibility, full-defense timing,
disarm damage/equipment rules, ranged-band modifiers/damage, critical defense
handling, and how many defenses each combatant type is allowed.

## Priority 0 — establish the correct combat contract

### [x] CMB-01: Create a rules parity matrix and action vocabulary

Build a small machine-readable combat rule model before changing the Discord
flow. It should separate rules from presentation and identify house rules.

Deliverables:

- Define action kinds: `ACTION`, `FREE_ACTION`, `DEFENSE`, and system-triggered
  reactions.
- Define attack kinds and defense options, including eligibility reasons and
  modifiers.
- Record whether a rule is core DSA 5, optional/focus rule, or DSANewBot house
  rule. Existing decisions in `docs/combat-rules-decisions.md` must be retained
  or deliberately superseded with a note.
- Add a parity table covering melee, ranged, shield parry, dodge, criticals,
  multiple defenses, incapacitation/status restrictions, longer actions,
  maneuver combinations, and NPC defense limits.

Acceptance criteria:

- [x] Rule evaluation is testable without Discord interactions.
- [x] An unavailable choice has a stable reason code suitable for both Discord
      and API clients.
- [x] No rule is silently labeled official when it is a house rule or an open
      decision.

Likely files: a new focused module under `services/` or `utils/`,
`docs/combat-rules-decisions.md`, and combat unit tests.

### [x] CMB-02: Split attack checking from attack resolution

Recommended command contract:

- `/attack-check`: target-free and non-mutating. It rolls the selected
  character's equipped attack (plus an optional maneuver/modifier), displays
  the roll and effective value, and never rolls defense or changes HP.
- `/attack-resolve`: explicitly targets another character and performs the full
  standalone resolution. Until CMB-03 is complete, it may preserve the current
  legacy behavior behind a clearly labeled warning; afterward it must use the
  same defender-choice engine as tracked combat.

Acceptance criteria:

- [x] `/attack-check` has no required Discord user option.
- [x] Tests prove that it performs no database write.
- [x] The mutating command name and confirmation make the side effect clear.
- [x] Help text, command registration tests, aliases, and documentation describe
      the two commands accurately.
- [x] Both commands use the shared visibility policy from VIS-01.

Primary touchpoints: `commands/attack-check.js`, `commands/attack.js`,
`commands/help.js`, `utils/commandRegistration.js`, and command tests.

## Priority 1 — defender choice and complete turn flow

### [x] CMB-03: Add a persisted pending-attack state machine

Split attack resolution into three idempotent operations:

1. Roll/validate the attack and create a pending resolution when defense input
   is required.
2. Accept exactly one authorized defense decision.
3. Finalize damage, effects, logs, and turn advancement transactionally.

The public combat message should show that it is waiting for the defender and
offer only eligible buttons, such as **Parry**, **Dodge**, and **Take Hit**. A
player controls their character's defense; the combat DM controls NPC defense.
Other users may see the controls but cannot use them. Provide a DM-only fallback
to resolve an abandoned prompt so combat cannot deadlock.

Acceptance criteria:

- [x] No HP, wound, equipment, or maneuver effect is applied before the defense
      decision is finalized.
- [x] Duplicate clicks, stale buttons, simultaneous responses, and retries
      cannot resolve the same attack twice.
- [x] Pending state survives bot restart and can restore the correct combat
      panel.
- [x] Declining or being unable to defend does not increment the defense count.
- [x] An attempted parry or dodge increments the shared defense count exactly
      once.
- [x] Turn advancement occurs only after finalization.
- [x] API and Discord paths call the same service operations.

Likely touchpoints: a schema migration for pending actions, `services/combat.ts`,
`api/routes/combat.ts`, `handlers/combatTurnHandler.js`,
`handlers/combatHandler.js`, `index.js`, transforms/recovery, and combat tests.

### [x] CMB-04: Implement defense choice and eligibility

Replace the single `resolveDefense(paValue)` assumption with evaluated defense
options.

Required behavior:

- Parade uses the correct equipped weapon/shield and PA modifiers.
- Dodge uses AW and the same accumulated multiple-defense count.
- Ranged attacks offer dodge and shield parry only when legal, with the proper
  attack-type modifiers.
- Creature size, statuses, effects, critical results, maneuver rules, equipment,
  and longer-running actions can remove or alter options.
- If defending would interrupt casting/reloading/another longer action, the UI
  says so before confirmation and applies the interruption atomically.
- The combat log records offered choice, selected choice, effective value,
  roll, and why no defense was possible without leaking private data.

Tests must cover melee parry, dodge, ranged shield defense, ranged non-shield
parry rejection, decline, prohibited defense, multiple defenses, criticals,
casting interruption, NPC control, and restart recovery.

### [x] CMB-05: Replace the three-button turn row with a rules-aware action menu

Use one **Choose action** entry point that derives available options from the
active combatant's state. It should expose existing mechanics and leave room for
new ones without adding a permanent button for every action.

Initial categories:

- **Attack:** standard, learned compatible maneuver, ranged parameters, hit
  zone, two-weapon, and granted opportunity attack.
- **Special combat action:** full defense when its timing is legal, reload,
  stand up, escape grapple, retrieve a dropped item, and future maneuvers.
- **Spell/liturgy:** learned abilities, casting time, target, modifier, and
  AsP/KaP cost using the existing supernatural service.
- **Generic action:** record a short description such as opening a door,
  helping an ally, using an object, or any GM-adjudicated action, then consume
  the action and log it.
- **Free action:** a separately tracked, optional description/movement action.
- **Resource adjustment:** spend AsP/KaP/SchP with a reason. This is not
  automatically an action unless invoked as part of an action such as casting;
  the log must make that distinction clear.
- **End turn.**

Acceptance criteria:

- [x] The menu hides or disables illegal choices with an explanation.
- [x] Existing `/combat-action` functionality is reachable without knowing a
      separate slash command.
- [x] Target selectors use combatant IDs and therefore support both players and
      NPCs; they are not limited to Discord user pickers.
- [x] A generic action consumes the action once, is bounded/sanitized, and is
      visible in the combat log.
- [x] AsP/KaP spending reuses `services/resources.ts` or
      `services/supernatural.ts`; no parallel resource counter is introduced.
- [x] Player and DM-controlled NPC flows have equivalent capabilities where the
      underlying character data permits them.

### [x] CMB-06: Correct and finish maneuver behavior

Start with `Entwaffnen`, because it is already partly implemented and was called
out directly.

- Apply its official AT modifier, two-handed adjustment, 1W3 TP, defense, and
  shield exclusion.
- Persist a dropped-equipment state rather than only clearing the equipped slot,
  then implement the retrieve-item action and opportunity consequence.
- Validate learned maneuver, compatible technique, prerequisites, and allowed
  base/special-maneuver combinations through the shared rules model.
- Audit trip, grapple, charge, full defense, two-weapon, opportunity, called
  shots, range bands, and hit-zone effects against the parity matrix.

Acceptance criteria:

- [x] Each maneuver has focused service tests for success, failed attack,
      successful defense, invalid equipment, invalid target, and rollback.
- [x] Discord only offers maneuvers valid for the chosen weapon and current
      state.
- [x] Rule deviations are documented as named house rules.

Completion note (2026-08-16): the maneuver behavior, dropped-item state,
retrieval/opportunity flow, shared eligibility evaluation, and sequential
defender choices for two-weapon attacks are implemented. Seven focused service
tests now exercise Entwaffnen success, failed attack, successful defense,
invalid equipment/target, transaction rollback, trip, grapple, called shots,
charge failure, opportunity attacks, full defense, and retrieval against a
freshly migrated and seeded disposable PostgreSQL database.

## Priority 1 — public presentation controls

### [x] VIS-01: Add one visibility contract to safe commands

Create a small shared helper that reads `visible` before acknowledging the
interaction. Discord cannot convert an already-ephemeral response into a public
one.

Add `visible` to:

- spell list/show/cast result;
- liturgy list/show/perform result;
- learned special abilities;
- maneuver list/show;
- standalone attack and evade checks;
- other read-only catalog/detail commands found by the command audit.

Policy:

- Default remains private to preserve current behavior.
- Public display is opt-in with `visible:true`.
- Learning, editing, importing, backups, secret notes, authorization errors, and
  other sensitive/mutating administration remain private.
- Public messages must not reveal internal IDs, secrets, hidden DM data, or
  resource details unrelated to the displayed action.

Acceptance criteria:

- [x] Registration tests confirm the option on every in-scope subcommand.
- [x] Execution tests cover both ephemeral and public responses.
- [x] Spell/liturgy execution can publicly show what was used, the result, QS,
      and paid resource cost.
- [x] Help text explains the default once rather than repeating it noisily.

## Priority 2 — campaign PDF character import

### [x] IMP-01: Add a versioned PDF profile and field inventory

The inspected upload is a 12-page, fillable `DSA5-Dokument V1.93`. It contains
an AcroForm with 3,788 named fields (text, choices, buttons, and parent fields)
and embedded PDF JavaScript. The importer should read field values directly; it
should not use OCR and must never execute the document's JavaScript.

Create a reusable profile identified by structural characteristics rather than
the uploaded file name or a hash of its personal values:

- title/version and page count;
- sorted field-name/type signature;
- sentinel fields such as `MU_1`, `KL_1`, `Talent_FW_*`, armor, resource,
  spell, and liturgy fields;
- explicit mappings with conversion and validation rules.

The first mapping report should cover identity/background, attributes, derived
values, LeP/AsP/KaP/SchP, AP, talents, combat techniques, weapons, armor,
special abilities, spells, and liturgies. It must also identify model gaps such
as SK/ZK, advantages/disadvantages, zoned armor, and custom rows.

Acceptance criteria:

- [x] Unsupported variants fail with a useful version/fingerprint report.
- [x] Parent/kid inheritance, duplicate widgets, choice values, checkboxes, and
      blank calculated fields are tested.
- [x] Parsing has byte/page/field/time limits, validates PDF magic/MIME, rejects
      encrypted or malformed inputs, and does not execute actions/scripts.
- [x] Logs contain profile/version/counts only, never character field values.
- [x] The real uploaded sheet and its personal values are not committed as a
      test fixture; tests use a generated or sanitized fixture.

### [x] IMP-02: Implement an ephemeral preview-and-confirm import

Extend `/character import` to accept JSON or a supported PDF. The inspected PDF
is approximately 5.6 MB, so the current 2 MB JSON limit is insufficient. Add a
separate bounded PDF limit (recommended application cap: 10 MiB, never above the
interaction's reported attachment limit) and keep bounded download time/size.

Flow:

1. Detect format and profile.
2. Parse and normalize without a database write.
3. Show an ephemeral preview with mapped counts, warnings, conflicts, omitted
   fields, and the proposed character name.
4. Require **Import** or **Cancel** from the invoking user.
5. Create the character and all mapped relations in one transaction.

Acceptance criteria:

- [x] No character exists before confirmation.
- [x] A failure rolls back the complete import; no compensating delete is
      required.
- [x] Unknown/custom fields are reported instead of silently discarded.
- [x] Catalog matches show exact, normalized/alias, ambiguous, and unresolved
      counts.
- [x] Repeated confirmation is idempotent and short-lived preview state cannot
      be used by another Discord user.
- [x] Completion tells the user how to select the new character and where to
      find unresolved data.

### [x] IMP-03: Import in useful slices

Implement the field map in this order so each release is independently useful:

1. Core identity, attributes, resources, AP, initiative, dodge, base combat
   values, and background.
2. Talents and combat techniques with catalog reconciliation.
3. Weapons, shields, armor, and equipped state.
4. Special abilities and maneuvers.
5. Spells/rituals and liturgies/ceremonies.
6. Schema extensions for approved gaps such as SK/ZK, advantages,
   disadvantages, and zoned armor.

Each slice needs mapping fixtures, preview snapshots, service tests, a
transaction rollback test, and a documented unresolved-field report. A slice
is only checked off when all fields named for that slice are supported or
explicitly listed as unsupported.

Completion note (2026-08-16): all six mapping slices and their generated PDF
fixtures are implemented, including SK/ZK and typed gap records. The service
suite imports every slice and verifies a late-write full rollback against a
freshly migrated and seeded disposable PostgreSQL database. Test data is
namespaced so cleanup cannot remove shared canonical catalog rows.

## Priority 2 — Discord-native visual redesign

### [ ] UI-01: Prototype a Components V2 renderer

Discord now supports component-only messages with Containers, Sections, Text
Displays, Separators, Thumbnails, Media Galleries, Files, buttons, and selects.
This offers better grouping and action placement than a legacy embed, but it is
not a drop-in skin:

- the `IS_COMPONENTS_V2` flag is permanent for that message;
- traditional `content` and `embeds` cannot be mixed into that message;
- attachments must be exposed through components;
- the installed `discord.js` 14.15.3 does not expose the Components V2 builders,
  so a reviewed dependency upgrade is required first.

Build three side-by-side prototypes behind pure payload builders:

1. active combat and pending defense;
2. spell/liturgy detail and execution result;
3. compact character sheet/resources.

Compare them on desktop and mobile using real Discord screenshots. Evaluate
scan order, action discoverability, component limits, accessibility, update
behavior, and degraded/error states. Keep legacy embeds for simple messages and
as a fallback until the pilot is accepted.

Acceptance criteria:

- [x] Dependency upgrade passes command validation and the full relevant test
      suite before UI conversion begins.
- [x] Payload builders are serializable and tested against Discord component
      limits.
- [x] Deferral/edit behavior is tested, because Components V2 interaction
      responses have stricter response rules.
- [ ] The user approves one visual direction from screenshots before broad
      migration.

Implementation note (2026-08-16): the dependency upgrade, six pure review
views, serialization/update tests, and development-only `/dev-ui-prototypes`
command are ready. The code direction has been carried into the high-value
production views under UI-02. UI-01 remains open only for the explicitly human
desktop/mobile screenshot approval; that approval is not claimed by automated
tests.

### [x] UI-02: Migrate high-value views, then stop and reassess

If the pilot is accepted, migrate in this order:

1. combat lobby, active combat, action selection, and pending defense;
2. character overview and resource changes;
3. spell/liturgy/maneuver detail;
4. inventory, weapons, party, and long catalogs only if Components V2 improves
   them measurably.

Do not convert short confirmations and errors into heavy cards. Update
`docs/discord-embed-style.md` into a general Discord presentation guide that
documents when to use plain text, an embed, Components V2, or an attachment.

Completion note (2026-08-16): new combat lobbies, active combat/turn controls,
pending defense, character overview, AsP/KaP/SchP changes, and
spell/liturgy/maneuver details and execution results now use Components V2.
Existing combat messages continue through their legacy embed path so an update
does not violate Discord's permanent message flag. Inventory, weapons, party,
and long catalogs deliberately remain paginated embeds because V2 would not
improve their scanability or pagination behavior. Short confirmations and
errors remain plain text.

## Suggested implementation order

1. CMB-01 and CMB-02
2. CMB-03 and CMB-04
3. CMB-05 and CMB-06
4. VIS-01
5. IMP-01 and IMP-02
6. IMP-03 in its numbered slices
7. UI-01, user visual review, then UI-02

CMB-03/CMB-04 are the highest-risk changes and should not be combined with the
visual migration. The combat state must be correct before its presentation is
redesigned.

## Verification expected for every completed item

- Focused unit tests for rules and payload builders.
- Service/API integration tests for transactions, authorization, idempotency,
  and restart recovery.
- Command schema validation and mocked interaction tests.
- `npm run format:check`, `npm run lint`, `npx tsc --noEmit`,
  `npm run test:commands`, and the relevant project tests.
- Manual guild verification only when command deployment is separately
  authorized. No global command deployment is implied by this backlog.

## Primary references

- [DSA Regelwiki: Handlungen](https://dsa.ulisses-regelwiki.de/Nah-_und_Fernkampf/handlungen.html)
- [DSA Regelwiki: Grundbegriffe des Kampfes](https://dsa.ulisses-regelwiki.de/Kampf_Grundbegriffe-des-Kampfes.html)
- [DSA Regelwiki: Fernkampf](https://dsa.ulisses-regelwiki.de/Fernkampf.html)
- [DSA Regelwiki: Entwaffnen](https://dsa.ulisses-regelwiki.de/KSDF_Entwaffnen.html)
- [DSA Regelwiki: Gegenstände im Kampf aufheben](https://dsa.ulisses-regelwiki.de/GR_Kampf-GegenstandAufheben.html)
- [DSA Regelwiki: Verteidigungshaltung](https://dsa.ulisses-regelwiki.de/KSF_Verteidigungshaltung.html)
- [Discord: Component reference](https://docs.discord.com/developers/components/reference)
- [Discord: Message and embed limits](https://docs.discord.com/developers/resources/message)
- [discord.js: ContainerBuilder](https://discord.js.org/docs/packages/discord.js/main/ContainerBuilder%3AClass)
