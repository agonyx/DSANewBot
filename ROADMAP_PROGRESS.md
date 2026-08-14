# DSANewBot Roadmap Progress

Evidence-based implementation ledger for the committed roadmap scope. This file
tracks the repository state, not aspirational status. It is updated after every
checkpoint.

Last audit: 2026-08-14

## Status key

- **DONE**: implemented across the required layers and supported by verification evidence.
- **PARTIAL**: working pieces exist, but one or more acceptance criteria are unmet.
- **MISSING**: no usable implementation exists.
- **STALE**: the roadmap/audit claim is contradicted by the current code.
- **BLOCKED**: remaining work requires an external dependency or authorization.

## Current verification baseline

| Check                   | Result         | Evidence / limitation                                                                                                                                                         |
| ----------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full test gate          | **PASS**       | `npm test` on isolated Netcup PostgreSQL: 142/142 Node API/mechanics tests and 220/220 Jest command/unit tests pass (362 total).                                              |
| Command surface         | **PASS**       | 76 source modules validate as exactly 36 production commands and 38 development commands; canonical family trees and `/inventory`, `/inv`, `/items` equivalence are asserted. |
| TypeScript              | **PASS**       | `npx tsc --noEmit`: zero errors at the final verified revision.                                                                                                               |
| Lint                    | **PASS**       | `npm run lint`: zero errors and 23 pre-existing warnings (two fewer than the starting baseline; no new warnings).                                                             |
| Repository formatting   | **KNOWN FAIL** | Pre-existing baseline is 87 files. Per the execution contract, unrelated files were not reformatted.                                                                          |
| Changed-file formatting | **PASS**       | Prettier passes on every formatter-supported file changed by the committed roadmap, Nice-to-Have, and command-cleanup slices.                                                 |
| Migration               | **PASS**       | A fresh `pgvector/pgvector:pg16` container applied all 11 ordered migration files plus vector SQL; Drizzle reports 35 tables and no schema changes.                           |
| Catalog seed            | **PASS**       | Two consecutive clean-room seed runs succeeded: 59 talents, 14 maneuvers, 461 spells, 353 liturgies, 20 equipment entries, and 967 special abilities.                         |
| Isolation               | **PASS**       | Command-cleanup regression tests ran in a disposable Node container on the separate `dsa-discord-test` network/database; production `dsa-db` was not contacted.               |

The scoped Graphify pass found 1,165 DSANewBot nodes, 2,199 relationships, and
58 labeled communities. The bounded semantic retry produced 50 document nodes,
58 edges, and 2 hyperedges. Graph diagnostics report no dangling, missing, or
collapsed edges. This evidence supplements direct inspection of the named source
files and code; semantic-worker token telemetry was unavailable and is recorded
as such in `graphify-out/cost.json`.

## Cross-cutting acceptance criteria

Every feature slice must include, where applicable:

- schema plus an ordered Drizzle migration and clean-database migration proof;
- validated service/API behavior with ownership or DM authorization;
- Discord command/component UX, registration metadata, and `/help` coverage;
- persistence and restart recovery for durable state;
- explicit business rules, error handling, and non-obvious mechanics decisions in `docs/`;
- targeted tests plus the full `npm test`, lint, and changed-file Prettier gates.

## In-scope inventory

### Priority 1 — Core Mechanics

#### Wounds and healing

| Item                            | Status   | Current evidence                                                                                                                        | Acceptance criteria / remaining work                              |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Wound tracking separate from LP | **DONE** | Stats/combatant counters synchronize on combat, treatment, and regeneration; negative LeP is preserved for stabilization.               | Met: clean migrations and wound/combat/resource regressions pass. |
| Wound threshold based on KO     | **DONE** | Player threshold is `floor(KO/2) + modifier`; NPCs accept an explicit threshold; rules and unit tests cover bounds.                     | Met: threshold and live combat regressions pass.                  |
| Wound penalties                 | **DONE** | `-1` per wound (cap `-3`) is applied to talent attributes and AT/PA in Discord and service combat paths and displayed in UX.            | Met: probe and combat regressions pass.                           |
| Natural wound healing           | **DONE** | A completed regeneration phase heals one aggregate wound and consumes pending treatment/pain state transactionally.                     | Met: live regeneration regression passes.                         |
| First aid / wound treatment     | **DONE** | Shared service/API/Discord command implements healing, pain relief, stabilization, bleeding, authorization, audit ledger, and error UX. | Met: wound authorization and treatment regressions pass.          |
| Incapacitation at wound limit   | **DONE** | Three wounds reject attacks and prevent defense; recovery below the limit restores eligibility; UI exposes capability.                  | Met: live action and recovery regressions pass.                   |

#### Conditions and status-effect lifecycle

| Item                                    | Status   | Current evidence                                                                                                                        | Acceptance criteria / remaining work                                                       |
| --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Condition/status CRUD commands          | **DONE** | `/condition` and `/status`, persistent `combatant_conditions` / `combatant_statuses`, command metadata.                                 | Met: existing commands are reused and the lifecycle/authorization rows below are complete. |
| Poison                                  | **DONE** | Typed DOT/check/AT/PA payloads tick at turn end, synchronize wounds/LP, expire, display, and have pure/live regressions.                | Met: clean live combat lifecycle regression passes.                                        |
| Disease                                 | **DONE** | `krank` supports source-specific escalating damage with a configured cap, duration, display, and DM removal/treatment.                  | Met: lifecycle and authorization coverage passes.                                          |
| Stun / paralysis                        | **DONE** | Condition penalties, level-IV/aggregate incapacitation, round/rest duration, and action enforcement are shared across services.         | Met: action/recovery coverage passes.                                                      |
| Fear / terror                           | **DONE** | Owner/DM Willenskraft resistance decrements Furcht, with wound/condition penalties, source removal, and duration support.               | Met: resistance and authorization coverage passes.                                         |
| Exhaustion / fatigue                    | **DONE** | Überanstrengung applies check penalties and -1/-2 resource regeneration, then recovers through rest-duration lifecycle.                 | Met: regeneration coverage passes.                                                         |
| Buff tracking                           | **DONE** | `combatant_effects` persists numeric combat/check modifiers, prohibitions, source, and duration; restart recovery and UX include them.  | Met: migration/persistence coverage passes.                                                |
| Effect duration                         | **DONE** | Validated status/condition/effect durations decrement on their documented turn boundary; rest effects recover during regeneration.      | Met: round/rest lifecycle coverage passes.                                                 |
| Turn start/end effect ticks             | **DONE** | `advanceTurn()` applies DOT/wounds and expiry transactionally, checks victory after ticks, logs results, and refreshes the mirror.      | Met: live round-transition coverage passes.                                                |
| Incapacitation from conditions/statuses | **DONE** | Pain IV, three wounds, level-IV conditions, eight aggregate levels, and direct statuses block the appropriate action/defense paths.     | Met: action/defense authorization coverage passes.                                         |
| Restart recovery                        | **DONE** | Recovery loads all persisted conditions, statuses, and effects into combatants and reconstructs derived display state.                  | Met: persisted recovery paths and component tests pass.                                    |
| Authorization                           | **DONE** | Session impersonation/add/remove gaps are closed; DM-only effect mutations and owner/DM resistance use shared services for API/Discord. | Met: forbidden-path and impersonation regressions pass.                                    |

#### Combat completeness

| Item                     | Status   | Current evidence                                                                                                                                        | Acceptance criteria / remaining work                  |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Multiple-defense penalty | **DONE** | Persisted counters apply -3 per prior defense, -2 with Meisterparade, reset each round, display, and have deterministic/live tests.                     | Met: live round coverage passes.                      |
| Called shots             | **DONE** | Melee/ranged target-zone inputs, modifiers, humanoid tables, hit-zone persistence, Selbstbeherrschung wound effects, and UX are implemented.            | Met: attack and component coverage passes.            |
| Disarm                   | **DONE** | Catalog/prerequisite validation and transactional eligible-weapon unequip behavior are implemented.                                                     | Met: maneuver coverage passes.                        |
| Trip / knockdown         | **DONE** | Size/technique restrictions, Liegend application, penalties, and stand-up action/API/Discord UX are implemented.                                        | Met: maneuver/action coverage passes.                 |
| Grappling                | **DONE** | Haltegriff applies Fixiert/Eingeengt, restricts the grappler, and exposes a KK escape action with logs.                                                 | Met: maneuver/action coverage passes.                 |
| Two-weapon fighting      | **DONE** | Two one-handed weapons, training/off-hand penalties, two targets, separate defenses, first-botch cancellation, service/API/Discord UX, and tests exist. | Met: compound live regression passes.                 |
| Opportunity attacks      | **DONE** | Persisted, unopposed AT-4 reactions are consumed on use and expire at the round boundary; failed charge grants them.                                    | Met: lifecycle coverage passes.                       |
| Charge attack            | **DONE** | Sturmangriff validates 4..GS distance/prerequisites, applies AT/TP rules, and grants the failure reaction.                                              | Met: maneuver coverage passes.                        |
| Full defense stance      | **DONE** | Learned Verteidigungshaltung spends the action, persists +4 PA/action prohibition, and expires at next turn start.                                      | Met: stance lifecycle coverage passes.                |
| Ranged combat            | **DONE** | Persisted technique/range/reload/hand data, range bands, cover, reload actions, service/API/Discord inputs/display, migration, and tests exist.         | Met: migration/live inventory-combat coverage passes. |
| Combat maneuver effects  | **DONE** | Catalog includes committed core options, list/detail APIs/commands, learned/prerequisite checks, shared effect handlers, and rules documentation.       | Met: seeded catalog/action coverage passes.           |
| NPC skill actions        | **DONE** | DM maneuver/target menus call the shared attack service; restart state is preserved.                                                                    | Met: Discord component and combat coverage passes.    |

### Priority 2 — Character Systems

#### Magic

| Item                           | Status   | Current evidence                                                                                                                                                | Acceptance criteria / remaining work                |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Spells table/catalog           | **DONE** | `spells` plus source metadata/effects, idempotent local Regelwiki import (467 parsed rows; 461 canonical entries), API/Discord browse/detail, and parser tests. | Met: clean migration and two idempotent seeds pass. |
| AsP tracking                   | **DONE** | Existing `/asp`/resource/regeneration paths are reused by transactional casting and permanent costs; supernatural help is registered.                           | No remaining Magic-slice work.                      |
| Spell casting probes           | **DONE** | Learned FtW, 3d20/QS, explicit/wound/condition modifiers, failed half cost, turn restrictions, audit history, API/Discord UX.                                   | Met: deterministic live casting coverage passes.    |
| Damage/healing/utility effects | **DONE** | Typed damage/healing/buff/condition/status effects reuse combat/wound/resource state; every other accepted ability persists narrative utility.                  | Met: effect persistence/lifecycle coverage passes.  |
| Schools / traditions           | **DONE** | Persisted profile, normalized distribution/aspects, general-ability rules, and case-safe tradition compatibility are enforced.                                  | Met: profile/compatibility coverage passes.         |
| Learning requirements          | **DONE** | Tradition/AP/ownership checks, duplicate prevention, learned relation, and AP ledger spending are atomic.                                                       | Met: duplicate/insufficient-AP coverage passes.     |
| Ritual magic                   | **DONE** | Ritual catalog types, asynchronous pending/completion/cancellation state, concentration lock, half-cost interruption, authorization, and UX.                    | Met: lifecycle/cancellation coverage passes.        |
| Spell duration                 | **DONE** | Persisted supernatural effect instances, timestamp expiry, shared round ticking, combat-effect synchronization, restart-visible history.                        | Met: duration/persistence coverage passes.          |

#### Karma

| Item                        | Status   | Current evidence                                                                                                                                              | Acceptance criteria / remaining work                |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Liturgies table/catalog     | **DONE** | `liturgies` plus local source metadata, aspects/effects, idempotent import (363 parsed rows; 353 canonical entries), API/Discord browse/detail, parser tests. | Met: clean migration and two idempotent seeds pass. |
| KaP tracking                | **DONE** | Existing `/kap`/resource/regeneration paths are reused by liturgies, blessings, ceremonies, permanent costs, and miracles; help is complete.                  | No remaining Karma-slice work.                      |
| Blessed actions             | **DONE** | Learned liturgy/ceremony/blessing execution shares probes, costs, targets, typed effects, pending lifecycle, authorization, and UX.                           | Met: live casting/effect coverage passes.           |
| Religious traditions / gods | **DONE** | Profile persists blessed tradition, deity, favored talents, and aspects; learning/casting enforce compatible tradition and deity.                             | Met: live compatibility coverage passes.            |
| Miracle mechanics           | **DONE** | Documented 4-KaP favored talent/AT/PA actions, equipped favored-technique checks, atomic spend, consumption, and round-boundary expiry.                       | Met: favored-talent and combat coverage passes.     |

#### AP-based advancement

| Item                   | Status   | Current evidence                                                                                                                                                                                                                                                       | Acceptance criteria / remaining work              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| AP tracking            | **DONE** | Owner-scoped awards, totals/balances, 50-entry summary, immutable actor ledger, `/advance`, HTTP API, stat display, validation, and atomic tests are implemented.                                                                                                      | Met: live ledger/rollback coverage passes.        |
| Level-up mechanics     | **DONE** | DSA's no-level AP purchase model, target-value tables, atomic one-step operations, error UX, and rules decisions are implemented and documented.                                                                                                                       | Met: live service/API coverage passes.            |
| Attribute advancement  | **DONE** | All eight attributes raise one point with target-value cost, atomic ledger spend, validation, and KK equipment resynchronization.                                                                                                                                      | Met: cost/rollback coverage passes.               |
| Learn talents          | **DONE** | All 59 seeded DSA talents are always active at FW 0; migration backfills existing characters and deduplicates legacy relations while preserving highest FW.                                                                                                            | Met: clean seed/backfill behavior is verified.    |
| Raise FtW              | **DONE** | Talent A–D costs, highest-participating-attribute +2 cap, supernatural FW costs/caps, atomic persistence, API/Discord autocomplete, and pure/live tests exist.                                                                                                         | Met: cap/cost/rollback coverage passes.           |
| Learn spells/liturgies | **DONE** | Existing atomic activation is joined by spell/ritual/liturgy/ceremony FW raises; FW 14 cap is enforced pending feature/aspect-knowledge representation.                                                                                                                | Met: learning/improvement coverage passes.        |
| Special abilities      | **DONE** | Fourteen executable combat abilities plus 967 canonical fixed-cost magical/karmic Regelwiki entries have unique ownership, atomic AP learning, source prerequisites, automatic attribute/tradition checks, and explicit table confirmation for unmodeled requirements. | Met: seed/prerequisite/duplicate coverage passes. |

### Priority 3 — Equipment & Economy

#### Economy

| Item              | Status   | Current evidence                                                                                                                          | Acceptance criteria / remaining work                     |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Four currencies   | **DONE** | Kreuzer-backed non-negative wallets, four-way conversion/display, immutable ledger, API, and `/wallet` exist.                             | Met: live wallet ledger coverage passes.                 |
| Buy / sell        | **DONE** | `/shop` and API perform atomic catalog materialization/payment and unequipped half-value sales with validation.                           | Met: purchase/sale transaction coverage passes.          |
| Price lists       | **DONE** | Source-enriched, idempotently seeded 20-entry core catalog stores price, weight, equipment, armor, shield, ranged, and provenance fields. | Met: two clean-room seed runs store 20 entries.          |
| Loot distribution | **DONE** | Tiered deterministic planner plus ended-combat DM generation, participant-scoped view, transactional awards, API, and `/loot` exist.      | Met: DM/participant/distribution coverage passes.        |
| Player trade      | **DONE** | Persisted offer/accept/decline/cancel/expiry flow revalidates and locks funds/assets before an atomic swap; API and `/trade` exist.       | Met: ownership/revalidation/atomic-swap coverage passes. |

#### Armor and complete equipment

| Item                           | Status   | Current evidence                                                                                                                         | Acceptance criteria / remaining work                   |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Armor table/items              | **DONE** | Catalog-linked armor items persist RS/BE/value/weight/slot/equip state; CRUD, stack splitting, migration, API, and Discord UX exist.     | Met: clean migration and equip/conflict coverage pass. |
| RS and BE                      | **DONE** | Equipment synchronization derives total RS from natural plus worn armor and derives BE/load Belastung after every relevant mutation.     | Met: live derivation coverage passes.                  |
| Armor slots                    | **DONE** | Ten validated body slots replace conflicts atomically; seeded armor/clothing uses BODY/HEAD/BACK/HANDS/FEET.                             | Met: stack/slot coverage passes.                       |
| Shield mechanics               | **DONE** | Seeded shields carry shield technique, weight/value, AT modifier, and doubled active PA bonus per the local shield rule.                 | Met: catalog/equipment/combat coverage passes.         |
| Encumbrance                    | **DONE** | Armor BE plus excess carried weight derives Belastung, which affects AT/PA/initiative/GS/talent checks and incapacitates at IV.          | Met: combat/probe integration coverage passes.         |
| Carrying capacity              | **DONE** | Gram-safe aggregation implements KK × 2 Stein capacity and one Belastung per full additional 4 Stein; `/equipment show` displays totals. | Met: inventory and advancement coverage passes.        |
| Clothing / non-armor equipment | **DONE** | Catalog and custom items support CLOTHING/GEAR/CONSUMABLE types, values, weights, body slots, equip state, trade, sale, and loot.        | Met: catalog/custom-item coverage passes.              |
| Equipment weight               | **DONE** | Integer grams persist on items/weapons, aggregate by quantity, exclude only the one worn armor unit, and drive load state.               | Met: migration/aggregate coverage passes.              |
| Full slot system               | **DONE** | Body equipment uses ten validated slots; weapons/shields retain ADAPTIVE/OFFENSE/DEFENSE hand semantics and all surfaces expose state.   | Met: mixed equipment/component coverage passes.        |

### Completion evidence map

Every DONE inventory row above belongs to one of these verified vertical slices.
The map links each slice to its persistence, implementation, rules record, and
executable evidence; command registration and `/help` metadata are covered by the
final command serialization/unit gate.

| Slice                       | Persistence and migrations                                                    | Service, API, and Discord implementation                                                                                                                   | Rules documentation                                                                      | Tests                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Wounds and healing          | `db/schema.ts`; `0001_wide_wrecking_crew.sql`–`0003_mighty_penance.sql`       | `services/wounds.ts`, `services/resources.ts`, `services/combat.ts`, `api/routes/wounds.ts`, `/treat-wounds`                                               | `docs/wound-system-rules.md`, `docs/heilkunde-wunden.md`                                 | `wound-utils.test.ts`, `wounds.test.ts`, `resources.test.ts`, `combat.test.ts`                                   |
| Combat and effects          | `db/schema.ts`; `0004_remarkable_crystal.sql`, `0005_simple_madame_hydra.sql` | `services/combat.ts`, `services/combatEffects.ts`, `services/maneuvers.ts`, combat/maneuver APIs and Discord commands/components                           | `docs/combat-rules-decisions.md` plus the local maneuver and condition/status references | `combat-effects.test.ts`, `combat.test.ts`, `combatUtils.test.js`, `combatComponents.test.js`                    |
| Magic and Karma             | `db/schema.ts`; `0006_freezing_klaw.sql`                                      | `services/supernatural.ts`, `api/routes/supernatural.ts`, catalog seeds, and supernatural Discord commands                                                 | `docs/supernatural-rules-decisions.md`                                                   | `supernatural-catalog.test.ts`, `catalog-seed.test.ts`, `supernatural.test.ts`                                   |
| Economy and equipment       | `db/schema.ts`; `0007_light_stick.sql`                                        | `services/economy.ts`, `services/equipment.ts`, `services/trades.ts`, `services/loot.ts`, economy API, `/wallet`, `/shop`, `/equipment`, `/trade`, `/loot` | `docs/economy-equipment-rules-decisions.md`                                              | `economy-utils.test.ts`, `economy.test.ts`, `inventory.test.ts`, combat integration tests                        |
| AP advancement              | `db/schema.ts`; `0008_new_mentor.sql`, `0009_faithful_vance_astro.sql`        | `services/advancement.ts`, `api/routes/advancement.ts`, `/advance special`, special-ability seed                                                           | `docs/advancement-rules-decisions.md`                                                    | `advancement-utils.test.ts`, `advancement.test.ts`, `special-ability-catalog.test.ts`, `catalog-seed.test.ts`    |
| Existing/reconciled systems | `0000_init.sql` and the complete ordered chain through `0010`                 | resources, character/talent/inventory/rules APIs; canonical command roots/aliases, registration, `/help`, and `/regel`                                     | `ROADMAP.md`, `COMMAND_AUDIT.md`, this ledger                                            | `foundation.test.ts`, `characters.test.ts`, `talents.test.ts`, `rules.test.ts`, `regel.test.js`, command routing |

### COMMAND_AUDIT reconciliation

| Item                        | Status      | Evidence / action                                                                                                                                  |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier 0 command naming       | **DONE**    | Related leaf commands are consolidated under noun roots; standalone rolls are `/attack-check` and `/evade-check`; legacy names are not registered. |
| Tier 1 CRUD gaps            | **DONE**    | `/weapon edit`, `/inventory edit`, and `/mob delete` delegate to the completed CRUD implementations.                                               |
| Tier 2 resources/conditions | **DONE**    | SchP, AsP, KaP, condition/status CRUD, regeneration, and displays exist; lifecycle/help gaps are tracked in their owning slices.                   |
| `/regel` availability       | **STALE**   | `commands/regel.js` and tests already exist despite older guidance saying the vector DB was not exposed.                                           |
| Loot / treasure tables      | **DONE**    | `/loot` and authenticated API implement tiered ended-combat pools, DM authorization, participant checks, and atomic awards; live regressions pass. |
| Combat log command          | **DONE**    | `/combat log` and `GET /combat/log` return the latest active or ended channel session; command/unit and live combat tests pass.                    |
| Maneuver library commands   | **DONE**    | `/maneuver list`, `/maneuver show`, and `/api/maneuvers` reuse the seeded catalog; seed and command tests pass.                                    |
| Tier 4                      | **BLOCKED** | Explicitly out of scope for this goal; no implementation will be attempted.                                                                        |

## Checkpoints, dependencies, and exit criteria

| Checkpoint                     | State    | Dependencies                                                                                | Exit criteria                                                                           |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0. Audit and ledger            | **DONE** | Direct code/docs/schema/test inspection plus healthy structural/semantic Graphify evidence. | Inventory classifies every in-scope item and reconciles stale roadmap/audit claims.     |
| 1. Wounds and healing          | **DONE** | Wound schema/service/API/Discord/docs/tests are complete.                                   | Clean migration and wound/combat/resource/treatment regressions pass.                   |
| 2. Combat and status lifecycle | **DONE** | Combat/effect persistence, services, UX, metadata, docs, and tests complete.                | Clean migrations plus live combat/status/inventory and component regressions pass.      |
| 3. Magic and Karma             | **DONE** | Catalogs, profiles, casting, lifecycle, miracles, UX, docs, and tests complete.             | Clean seed plus live casting, duration, cancellation, learning, and miracle tests pass. |
| 4. Economy and equipment       | **DONE** | Persistence, transactions, derived state, API/Discord UX, docs, and tests complete.         | Clean seed plus wallet/trade/loot/equipment tests pass.                                 |
| 5. AP advancement              | **DONE** | AP ledger and all committed purchase paths, UX, docs, and tests complete.                   | Clean seed plus grant, cost, cap, prerequisite, duplicate, and rollback tests pass.     |
| 6. Final reconciliation        | **DONE** | Roadmap/audit/help/metadata/migration/test evidence is reconciled.                          | Every in-scope stopping condition is verified at the pushed revision.                   |

## External blockers

None. The user authorized isolated Netcup testing, which resolved the unavailable
local-Docker blocker without touching the production database or container.

## Change log

### 2026-08-14 — Initial audit

- Read project instructions, roadmap, command audit, package scripts, all mechanics
  documents under `docs/`, schema/migrations, current wound diff, combat/resource/
  condition implementations, command registration, help metadata, and relevant tests.
- Confirmed stale roadmap assumptions: AsP, KaP, conditions/statuses, regeneration,
  and `/regel` already exist and must be extended rather than duplicated.
- Preserved all existing uncommitted wound-system files and changes.
- Verified wound calculations with 6 passing targeted tests at audit time.
- Confirmed lint baseline: 2 errors, 25 warnings.

### 2026-08-14 — Wound implementation checkpoint

- Added aggregate wound penalties to AT, PA, and every talent-probe attribute;
  three wounds now block attacks and defenses in both combat entry points.
- Added natural wound recovery and persistent Heilkunde Wunden applications for
  promoted healing, pain suppression, stabilization, and bleeding treatment.
- Added authenticated `/wounds/treat`, Discord `/treat-wounds`, shared error UX,
  treatment auditing, combatant synchronization, command metadata, and `/help` entries.
- Generated ordered Drizzle migrations `0002_long_susan_delgado.sql` and
  `0003_mighty_penance.sql` on top of the preserved user-authored wound migration.
- Added deterministic mechanics coverage plus live-DB treatment authorization,
  audit-ledger, and regeneration-state regressions.
- Verification: 11/11 wound utility tests pass, TypeScript passes, lint has zero
  errors and the unchanged 25 warnings, `git diff --check` passes, and all changed
  files pass Prettier. Clean migration and `npm test` remain blocked only by the
  unavailable local Docker daemon; the configured remote database was not touched.

### 2026-08-14 — Combat and status implementation checkpoint

- Added persisted status payloads and numeric effects with turn-end DOT/wound
  synchronization, disease progression, condition/status/effect expiry, rest
  recovery, exhaustion regeneration penalties, incapacitation, restart loading,
  DM mutation authorization, and owner/DM Furcht resistance.
- Completed the committed combat options: defense counters/Meisterparade, called
  shots and wound-effect resistance, disarm, trip/stand, grapple/escape,
  two-weapon attacks, round-bounded opportunity attacks, distance-validated
  Sturmangriff, Verteidigungshaltung, and ranged range/cover/reload handling.
- Expanded the maneuver catalog and prerequisites, added combat-technique weapon
  metadata, NPC shared-service maneuver handling, catalog list/detail UX,
  persisted effect display, and active/ended `/combat log` access.
- Generated `0004_remarkable_crystal.sql` for the effect/combat/ranged state and
  `0005_simple_madame_hydra.sql` for combat techniques; documented timing and
  rules decisions in `docs/combat-rules-decisions.md`.
- Verification: 18/18 pure combat/wound tests pass, TypeScript passes, 12 changed
  Discord command definitions serialize, lint has zero errors and the unchanged
  25 warnings, `git diff --check` passes, and every combat-checkpoint source/
  metadata file passes Prettier. Docker still has no engine endpoint, so clean
  migration execution, live integration tests, and full `npm test` remain blocked;
  the configured remote database was not touched.

### 2026-08-14 — Magic and Karma implementation checkpoint

- Added spell/liturgy catalogs, learned relations, supernatural profiles,
  cast/effect histories, AP transactions, and ordered migration
  `0006_freezing_klaw.sql`; the seed now imports 467 parsed/461 canonical magic
  entries and 363 parsed/353 canonical karmic entries from the local Regelwiki
  export.
- Added tradition/deity requirements, atomic AP learning, wound/condition-aware
  3d20 casting, full/failed/permanent resource costs, typed combat/healing effects,
  duration synchronization, pending ritual/ceremony completion, concentration,
  interruption/refund behavior, once-per-day blessings, and restart-visible audit
  state.
- Added 4-KaP favored talent/AT/PA miracles with equipped-technique checks,
  one-use consumption, and next-round expiry; documented all source mappings and
  asynchronous rules decisions in `docs/supernatural-rules-decisions.md`.
- Added authenticated supernatural API routes and seven Discord command surfaces
  with autocomplete, ownership-aware errors, combat turn consumption, help text,
  and metadata validation.
- Verification: 21/21 pure wound/combat/supernatural tests pass, TypeScript passes,
  seven command definitions serialize, lint has zero errors and the unchanged 25
  warnings, and changed formatter-supported files pass Prettier. Clean migration,
  seed execution, live integration tests, and full `npm test` remain blocked by the
  unavailable local Docker daemon; the configured remote database was not touched.

### 2026-08-14 — Economy and equipment implementation checkpoint

- Added non-negative Kreuzer-backed wallets with four-denomination conversion,
  immutable actor-attributed ledgers, tabletop adjustments, source-enriched
  equipment catalog seeding, atomic purchases, and unequipped half-value sales.
- Added catalog-linked/custom armor, clothing, gear, consumables, weapon values
  and weights, ten body slots, equipped-stack splitting, shield data, natural plus
  equipped RS, armor BE, KK-based capacity, and automatic Belastung synchronization.
- Integrated derived Belastung with shared condition incapacity, AT/PA, initiative,
  movement, and talent probes while preserving the documented casting and
  Selbstbeherrschung exceptions; legacy RS is copied to `natural_armor` by the migration.
- Added expiring atomic item/weapon/currency trades with acceptance-time locks and
  revalidation, plus tiered post-combat loot pools with ended-session DM authority,
  participant-scoped access, catalog grants, wallet awards, and completion state.
- Added authenticated `/economy` API routes and `/wallet`, `/shop`, `/equipment`,
  `/trade`, and `/loot` Discord surfaces, expanded inventory editors/displays and
  `/help`, generated `0007_light_stick.sql`, and documented policy decisions in
  `docs/economy-equipment-rules-decisions.md`.
- Verification: 27/27 pure wound/combat/supernatural/economy tests pass, TypeScript
  passes, ten affected command definitions serialize, lint has zero errors and the
  unchanged 25 warnings, and all formatter-supported checkpoint files pass Prettier.
  Full `npm test` timed out on unavailable database connections and Docker confirms
  the engine pipe is absent, so clean migration/seed and live integration evidence
  remain externally blocked; the configured remote database was not touched.

### 2026-08-14 — AP advancement implementation checkpoint

- Added target-value advancement utilities for columns A–D, attribute costs, and
  talent caps; enriched all 59 seeded talents with category, factor, and Belastung
  behavior and corrected the legacy `Sphärenkunde` spelling.
- Added owner-scoped AP awards and summaries, atomic attribute/talent/spell/liturgy
  improvements, FW caps, special-ability purchases, prerequisite/duplicate checks,
  and immutable actor-attributed ledger entries with rollback on failure.
- Added authenticated `/advancement` routes and `/advance` with autocomplete;
  migrated special-ability learning from free multi-assignment to the same AP-backed
  service, exposed AP on `/character sheet`, and updated command/help metadata.
- Generated `0008_new_mentor.sql` with catalog metadata, source-aligned maneuver AP
  costs, duplicate-safe unique ownership constraints, highest-FW preservation, and
  existing-character talent backfill. Documented mechanics and override boundaries
  in `docs/advancement-rules-decisions.md`.
- Added the 995-row/967-entry fixed-cost magical/karmic special-ability catalog,
  original
  Regelwiki rules/prerequisites/source links, automated core-attribute and tradition
  gates, explicit table confirmation for unmodeled requirements, learned-ability UX,
  idempotent seeding, and `0009_faithful_vance_astro.sql`.
- Verification: 36/36 pure/foundation tests pass, TypeScript passes, all command
  definitions serialize, lint has zero errors and 23 existing warnings (no new
  warnings), AP-checkpoint files pass Prettier, and `git diff --check` passes. The
  full suite and targeted live advancement test fail only at the isolated local
  connection boundary (`ECONNREFUSED 127.0.0.1:5432`); Docker still has no engine,
  so clean migration/seed and live integration proof remain externally blocked.

### 2026-08-14 — Final verification re-audit

- Requeried the current structural/semantic graph and directly re-audited roadmap
  checks, route mounts, command metadata, help coverage, migrations, placeholders,
  and the live worktree; no missing or duplicated in-scope implementation was found.
- Revalidated all 62 Discord command modules through the configured `tsx` loader;
  names are unique, definitions serialize, and every non-dev command is in `/help`.
- Reprobed Docker, Compose, Podman, PostgreSQL, Windows services/processes/pipes,
  local port 5432, WSL, and embedded database dependencies. Only the Docker client
  is installed; the daemon, Compose, PostgreSQL, and compatible local fallbacks are
  absent. The Docker init script passes `bash -n`.
- Verification: 36/36 foundation and deterministic mechanics/catalog tests pass;
  the full isolated-local suite discovers 127 tests, with 47 passing and 80 live-DB
  cases failing after `ECONNREFUSED 127.0.0.1:5432`. Drizzle reports 34 tables and
  no schema changes; TypeScript and Git whitespace checks pass; lint remains at zero
  errors and 23 existing warnings; all 120 changed/untracked files pass Prettier
  with unsupported formats ignored. The remote database was not contacted.

### 2026-08-14 — Third external-blocker audit

- Refreshed the existing graph lessons and requeried the roadmap-to-schema/service/
  test relationships; the graph and unchanged product worktree still support the
  same completion boundary.
- Reprobed Docker client/contexts/pipes, Compose, Docker Desktop, Podman, nerdctl,
  PostgreSQL commands/install locations, processes, Windows services, WSL, and the
  local port-5432 listener. The required local runtime remains absent.
- This is the third consecutive goal turn with the identical external blocker.
  Clean migration, seed, and live integration proof cannot proceed without a local
  Docker/PostgreSQL installation; remote mutation remains intentionally excluded.

### 2026-08-14 — Netcup clean-room completion

- User authorization enabled testing on Netcup. Created a temporary clone and an
  isolated `pgvector/pgvector:pg16` container with an in-memory data directory,
  no published port, and no shared production volume. The existing production
  `dsa-db` container remained running and was not mutated.
- A fresh initialization applied all 10 migrations (`0000`–`0009`), installed
  pgvector, applied the rules-vector SQL, and produced all 34 Drizzle tables.
  `npm run db:generate` then reported no schema changes.
- Fixed source-catalog conflicts found by the first clean seed. The seed now
  collapses semantic URL aliases before upsert, rejects divergent supernatural
  IDs, and preserves the two distinct `Astralraub` abilities under stable unique
  IDs. Two consecutive seeds succeeded with 59 talents, 14 maneuvers, 461 spells,
  353 liturgies, 20 equipment entries, and 967 special abilities.
- Removed the import-time OpenAI credential requirement, corrected the DSA 4
  `Athletik` test fixture to canonical DSA 5 `Heilkunde: Wunden`, serialized the
  shared-database API test files, and aligned `/regel` unit mocks with the service
  boundary. `npm test` now includes both test runners.
- Final verification at code revision `c775e469c5f7f9d8fa452a341a54430c756bb929`:
  130/130 API/mechanics tests and 214/214 command/unit tests pass; TypeScript and
  Drizzle generation pass; lint has zero errors and 23 pre-existing warnings; Git
  whitespace checks and Prettier on all 124 goal-changed files pass.
- `ROADMAP.md` has no unchecked in-scope item. Its remaining unchecked items are
  confined to the explicitly excluded Nice-to-Have sections. The current
  inventory and checkpoints above are DONE, with no external blocker remaining.

### 2026-08-14 — Character export, dice macros, and Discord test deployment

- Added `/character export` and `GET /characters/me/export`. The selected
  character is rendered as a safe UTF-8 text attachment containing attributes,
  resources, wounds, combat values, talents, weapons, inventory, special
  abilities, traditions, spells, liturgies, and wallet balances.
- Added per-character `/macro save|list|roll|delete` plus authenticated API
  routes. Names and dice expressions are normalized and bounded, ownership is
  derived from the selected character, duplicate names update atomically, and a
  character may store at most 50 macros.
- Added `dice_macros` persistence and migration `0010_skinny_killraven.sql`.
  A fresh isolated Netcup database applied all 11 migrations, installed pgvector
  and the vector-search SQL, and exposed 35 public tables. Drizzle generation
  reports no schema changes.
- Added deterministic export/dice utility tests plus live API coverage for UTF-8
  response metadata, validation, save/update/list/roll/delete behavior, caller
  isolation, and ownership. The full gate passes with 142 API/mechanics tests and
  214 Jest tests (356 total), followed by serialization of all 64 Discord
  commands. TypeScript, lint (zero errors; 23 existing warnings), Git whitespace,
  and changed-file Prettier checks pass.
- Live deployment exposed and fixed two registration/startup defects: the deploy
  entrypoint now installs the TypeScript resolver and returns a failing exit code
  on REST errors, and startup tolerates the intentionally absent optional
  `events/` directory. A production-runtime command validation gate prevents
  regression.
- Deployed all 64 commands to the configured Discord guild and started
  `dsa-discord-test-bot` against the isolated `dsa-discord-test-db`. Discord login
  as `Singularity#0898`, zero container restarts, `/health`, and `/ready` are
  verified. The production database/container remained untouched.
- Known test-data limitation: both production and isolated databases currently
  contain zero `rule_pages` and `rule_chunks`. `/regel` command wiring and empty
  result behavior are covered, but meaningful Regelwiki search cannot be
  exercised until a corpus is imported.

### 2026-08-14 — Discord command naming cleanup

- Consolidated character, combat, inventory, weapon, mob, maneuver, casting, and
  ability operations under stable noun roots. Renamed the two standalone rolls to
  `/attack-check` and `/evade-check` and stopped registering the legacy leaf names.
- Registered `/inventory` as the canonical item family with complete `/inv` and
  `/items` aliases. All three roots share the same metadata and delegated handlers.
- Centralized production/development/legacy registration policy for both runtime
  startup and command deployment. Development fixtures now require `DEV_MODE=true`.
- Retained each completed leaf handler as the internal implementation, so the
  cleanup changes Discord routing and discoverability without duplicating or
  replacing business logic. Updated command responses, `/help`, `ROADMAP.md`, and
  `COMMAND_AUDIT.md` to the canonical syntax.
- Verification: `npm test` passes 142/142 Node API/mechanics and 220/220 Jest
  command/unit tests (362 total) on isolated Netcup PostgreSQL. The command gate
  validates 76 source modules as exactly 36 production and 38 development
  commands. TypeScript passes; lint has zero errors and the unchanged 23 warnings;
  changed-file Prettier and Git whitespace checks pass.

### 2026-08-14 — Discord embed UX audit and cleanup

- Audited all 57 direct embed constructions across 43 runtime files. Embeds remain
  the correct Discord primitive for summaries, detail cards, editors, live combat,
  and roll results; variable lists now use bounded multi-embed pages, while concise
  mutation confirmations intentionally remain plain ephemeral messages.
- Centralized semantic colors, footers, progress bars, truncation, human-readable
  structured mechanics, and Discord limit-aware list/section paging in
  `utils/embedUtils.js`. Added an architecture regression that prevents direct
  `EmbedBuilder` or raw `setColor` use outside that presentation boundary.
- Extracted testable inventory, weapon, character-sheet, maneuver, mob, and ability
  views. Inventory now reports stacks, units, and total carried weight; weapons use
  mobile-readable full-width sections; the sheet separates attributes, wounds,
  combat, and resources; maneuver JSON is rendered as labeled rules; and all audited
  catalogs/logs/activity views avoid silent record truncation.
- Documented display-selection and layout policy in
  `docs/discord-embed-style.md`. No schema, migration, service contract, command
  name, or command-registration change was required.
- Verification: the complete isolated Netcup gate passes 142/142 API/mechanics and
  235/235 Jest tests (377 total), followed by serialization of all 76 source command
  modules as exactly 36 production and 38 development commands. TypeScript passes;
  lint has zero errors and 22 existing warnings (one fewer than the previous
  baseline); Git whitespace and changed-file Prettier checks pass. The refreshed
  `dsa-discord-test-bot` is logged in as `Singularity#0898`, has zero restarts, and
  returns HTTP 200 for both `/health` and `/ready` against the isolated test database.
