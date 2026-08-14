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

| Check                   | Result         | Evidence / limitation                                                                                                                    |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Pure mechanics tests    | **PASS**       | Wound, combat-effect, supernatural/equipment catalogs, economy, foundation, and advancement suites: 36/36 pass.                          |
| TypeScript              | **PASS**       | `npx tsc --noEmit`: zero errors through the AP Advancement slice.                                                                        |
| Full integration suite  | **BLOCKED**    | Current `npm test` discovers 127 tests: 47 pass and 80 live-DB cases fail after `ECONNREFUSED 127.0.0.1:5432`; `.env` remains untouched. |
| Lint                    | **PASS**       | `npm run lint`: zero errors and 23 existing warnings (two fewer than the starting baseline; no new warnings).                            |
| Repository formatting   | **KNOWN FAIL** | Pre-existing baseline is 87 files. Only files changed by this goal will be checked/formatted.                                            |
| Changed-file formatting | **PASS**       | Prettier passes on every formatter-supported file changed through the AP Advancement checkpoint.                                         |
| Migration               | **PARTIAL**    | Ordered migrations `0001`–`0009` and snapshots generate successfully; clean local execution is blocked by the unavailable Docker daemon. |

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

| Item                            | Status      | Current evidence                                                                                                                        | Acceptance criteria / remaining work                                             |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Wound tracking separate from LP | **PARTIAL** | Stats/combatant counters synchronize on combat, treatment, and regeneration; negative LeP is preserved for stabilization.               | Execute migrations and live-DB regressions on a clean local PostgreSQL instance. |
| Wound threshold based on KO     | **PARTIAL** | Player threshold is `floor(KO/2) + modifier`; NPCs accept an explicit threshold; rules and unit tests cover bounds.                     | Execute the generated migrations and combat integration test locally.            |
| Wound penalties                 | **PARTIAL** | `-1` per wound (cap `-3`) is applied to talent attributes and AT/PA in Discord and service combat paths and displayed in UX.            | Run the live combat/probe regression suite against the migrated database.        |
| Natural wound healing           | **PARTIAL** | A completed regeneration phase heals one aggregate wound and consumes pending treatment/pain state transactionally.                     | Run the new resources integration regression against the migrated database.      |
| First aid / wound treatment     | **PARTIAL** | Shared service/API/Discord command implements healing, pain relief, stabilization, bleeding, authorization, audit ledger, and error UX. | Run `tests/api/wounds.test.ts` and migration tests on local PostgreSQL.          |
| Incapacitation at wound limit   | **PARTIAL** | Three wounds reject attacks and prevent defense; recovery below the limit restores eligibility; UI exposes capability.                  | Complete live combat integration verification.                                   |

#### Conditions and status-effect lifecycle

| Item                                    | Status      | Current evidence                                                                                                                        | Acceptance criteria / remaining work                                                     |
| --------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Condition/status CRUD commands          | **DONE**    | `/condition` and `/status`, persistent `combatant_conditions` / `combatant_statuses`, command metadata.                                 | Reuse; do not duplicate. Authorization and service reuse are lifecycle follow-ups below. |
| Poison                                  | **PARTIAL** | Typed DOT/check/AT/PA payloads tick at turn end, synchronize wounds/LP, expire, display, and have pure/live regressions.                | Execute the live combat regression on a clean migrated database.                         |
| Disease                                 | **PARTIAL** | `krank` supports source-specific escalating damage with a configured cap, duration, display, and DM removal/treatment.                  | Execute lifecycle regressions on a clean database.                                       |
| Stun / paralysis                        | **PARTIAL** | Condition penalties, level-IV/aggregate incapacitation, round/rest duration, and action enforcement are shared across services.         | Execute the live action/recovery regressions.                                            |
| Fear / terror                           | **PARTIAL** | Owner/DM Willenskraft resistance decrements Furcht, with wound/condition penalties, source removal, and duration support.               | Execute the live resistance regression.                                                  |
| Exhaustion / fatigue                    | **PARTIAL** | Überanstrengung applies check penalties and -1/-2 resource regeneration, then recovers through rest-duration lifecycle.                 | Execute the regeneration integration regression.                                         |
| Buff tracking                           | **PARTIAL** | `combatant_effects` persists numeric combat/check modifiers, prohibitions, source, and duration; restart recovery and UX include them.  | Execute migration and persistence tests.                                                 |
| Effect duration                         | **PARTIAL** | Validated status/condition/effect durations decrement on their documented turn boundary; rest effects recover during regeneration.      | Execute live lifecycle tests.                                                            |
| Turn start/end effect ticks             | **PARTIAL** | `advanceTurn()` applies DOT/wounds and expiry transactionally, checks victory after ticks, logs results, and refreshes the mirror.      | Execute live round-transition tests.                                                     |
| Incapacitation from conditions/statuses | **PARTIAL** | Pain IV, three wounds, level-IV conditions, eight aggregate levels, and direct statuses block the appropriate action/defense paths.     | Execute live action authorization tests.                                                 |
| Restart recovery                        | **PARTIAL** | Recovery loads all persisted conditions, statuses, and effects into combatants and reconstructs derived display state.                  | Validate with a migrated database restart fixture.                                       |
| Authorization                           | **PARTIAL** | Session impersonation/add/remove gaps are closed; DM-only effect mutations and owner/DM resistance use shared services for API/Discord. | Execute live forbidden-path regressions.                                                 |

#### Combat completeness

| Item                     | Status      | Current evidence                                                                                                                                        | Acceptance criteria / remaining work                       |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Multiple-defense penalty | **PARTIAL** | Persisted counters apply -3 per prior defense, -2 with Meisterparade, reset each round, display, and have deterministic/live tests.                     | Execute live round tests.                                  |
| Called shots             | **PARTIAL** | Melee/ranged target-zone inputs, modifiers, humanoid tables, hit-zone persistence, Selbstbeherrschung wound effects, and UX are implemented.            | Execute live attack regressions.                           |
| Disarm                   | **PARTIAL** | Catalog/prerequisite validation and transactional eligible-weapon unequip behavior are implemented.                                                     | Execute live maneuver regression.                          |
| Trip / knockdown         | **PARTIAL** | Size/technique restrictions, Liegend application, penalties, and stand-up action/API/Discord UX are implemented.                                        | Execute live maneuver/action regressions.                  |
| Grappling                | **PARTIAL** | Haltegriff applies Fixiert/Eingeengt, restricts the grappler, and exposes a KK escape action with logs.                                                 | Execute live maneuver/action regressions.                  |
| Two-weapon fighting      | **PARTIAL** | Two one-handed weapons, training/off-hand penalties, two targets, separate defenses, first-botch cancellation, service/API/Discord UX, and tests exist. | Execute compound live regression.                          |
| Opportunity attacks      | **PARTIAL** | Persisted, unopposed AT-4 reactions are consumed on use and expire at the round boundary; failed charge grants them.                                    | Execute lifecycle regression.                              |
| Charge attack            | **PARTIAL** | Sturmangriff validates 4..GS distance/prerequisites, applies AT/TP rules, and grants the failure reaction.                                              | Execute live maneuver regression.                          |
| Full defense stance      | **PARTIAL** | Learned Verteidigungshaltung spends the action, persists +4 PA/action prohibition, and expires at next turn start.                                      | Execute live stance regression.                            |
| Ranged combat            | **PARTIAL** | Persisted technique/range/reload/hand data, range bands, cover, reload actions, service/API/Discord inputs/display, migration, and tests exist.         | Execute migration/live regressions.                        |
| Combat maneuver effects  | **PARTIAL** | Catalog includes committed core options, list/detail APIs/commands, learned/prerequisite checks, shared effect handlers, and rules documentation.       | Execute seeded catalog/live action regressions.            |
| NPC skill actions        | **PARTIAL** | DM maneuver/target menus now call the shared attack service; the placeholder path is removed and restart state is preserved.                            | Execute Discord component regression with a live database. |

### Priority 2 — Character Systems

#### Magic

| Item                           | Status      | Current evidence                                                                                                                                | Acceptance criteria / remaining work                            |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Spells table/catalog           | **PARTIAL** | `spells` plus source metadata/effects, idempotent local Regelwiki import (467 executable entries), API/Discord browse/detail, and parser tests. | Execute migration/seed/catalog regressions on clean PostgreSQL. |
| AsP tracking                   | **DONE**    | Existing `/asp`/resource/regeneration paths are reused by transactional casting and permanent costs; supernatural help is registered.           | No remaining Magic-slice work.                                  |
| Spell casting probes           | **PARTIAL** | Learned FtW, 3d20/QS, explicit/wound/condition modifiers, failed half cost, turn restrictions, audit history, API/Discord UX.                   | Execute deterministic live-DB casting regressions.              |
| Damage/healing/utility effects | **PARTIAL** | Typed damage/healing/buff/condition/status effects reuse combat/wound/resource state; every other accepted ability persists narrative utility.  | Execute effect persistence/lifecycle regressions.               |
| Schools / traditions           | **PARTIAL** | Persisted profile, normalized distribution/aspects, general-ability rules, and case-safe tradition compatibility are enforced.                  | Execute profile/compatibility regressions.                      |
| Learning requirements          | **PARTIAL** | Tradition/AP/ownership checks, duplicate prevention, learned relation, and AP ledger spending are atomic.                                       | Execute live duplicate/insufficient-AP regressions.             |
| Ritual magic                   | **PARTIAL** | Ritual catalog types, asynchronous pending/completion/cancellation state, concentration lock, half-cost interruption, authorization, and UX.    | Execute live lifecycle/concurrency regressions.                 |
| Spell duration                 | **PARTIAL** | Persisted supernatural effect instances, timestamp expiry, shared round ticking, combat-effect synchronization, restart-visible history.        | Execute live duration/restart regressions.                      |

#### Karma

| Item                        | Status      | Current evidence                                                                                                                              | Acceptance criteria / remaining work                            |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Liturgies table/catalog     | **PARTIAL** | `liturgies` plus local source metadata, aspects/effects, idempotent import (363 executable entries), API/Discord browse/detail, parser tests. | Execute migration/seed/catalog regressions on clean PostgreSQL. |
| KaP tracking                | **DONE**    | Existing `/kap`/resource/regeneration paths are reused by liturgies, blessings, ceremonies, permanent costs, and miracles; help is complete.  | No remaining Karma-slice work.                                  |
| Blessed actions             | **PARTIAL** | Learned liturgy/ceremony/blessing execution shares probes, costs, targets, typed effects, pending lifecycle, authorization, and UX.           | Execute live casting/effect regressions.                        |
| Religious traditions / gods | **PARTIAL** | Profile persists blessed tradition, deity, favored talents, and aspects; learning/casting enforce compatible tradition and deity.             | Execute live compatibility regressions.                         |
| Miracle mechanics           | **PARTIAL** | Documented 4-KaP favored talent/AT/PA actions, equipped favored-technique checks, atomic spend, consumption, and round-boundary expiry.       | Execute live talent/combat miracle regressions.                 |

#### AP-based advancement

| Item                   | Status      | Current evidence                                                                                                                                                                                                                                             | Acceptance criteria / remaining work                                  |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| AP tracking            | **PARTIAL** | Owner-scoped awards, totals/balances, 50-entry summary, immutable actor ledger, `/advance`, HTTP API, stat display, validation, and atomic tests are implemented.                                                                                            | Execute migration and live ledger/rollback regressions on PostgreSQL. |
| Level-up mechanics     | **PARTIAL** | DSA's no-level AP purchase model, target-value tables, atomic one-step operations, error UX, and rules decisions are implemented and documented.                                                                                                             | Execute live service/API regressions on the migrated database.        |
| Attribute advancement  | **PARTIAL** | All eight attributes raise one point with target-value cost, atomic ledger spend, validation, and KK equipment resynchronization.                                                                                                                            | Execute live cost/rollback regression.                                |
| Learn talents          | **PARTIAL** | All 59 seeded DSA talents are always active at FW 0; migration backfills existing characters and deduplicates legacy relations while preserving highest FW.                                                                                                  | Execute migration/backfill regression.                                |
| Raise FtW              | **PARTIAL** | Talent A–D costs, highest-participating-attribute +2 cap, supernatural FW costs/caps, atomic persistence, API/Discord autocomplete, and pure/live tests exist.                                                                                               | Execute live cap/cost/rollback regressions.                           |
| Learn spells/liturgies | **PARTIAL** | Existing atomic activation is joined by spell/ritual/liturgy/ceremony FW raises; FW 14 cap is enforced pending feature/aspect-knowledge representation.                                                                                                      | Execute live learning/improvement regressions.                        |
| Special abilities      | **PARTIAL** | Fourteen executable combat abilities plus 995 fixed-cost magical/karmic Regelwiki entries have unique ownership, atomic AP learning, source prerequisites, automatic attribute/tradition checks, and explicit table confirmation for unmodeled requirements. | Execute seed/prerequisite/duplicate regressions.                      |

### Priority 3 — Equipment & Economy

#### Economy

| Item              | Status      | Current evidence                                                                                                                          | Acceptance criteria / remaining work                                                      |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Four currencies   | **PARTIAL** | Kreuzer-backed non-negative wallets, four-way conversion/display, immutable ledger, API, and `/wallet` exist.                             | Execute wallet migration and live ledger regressions on clean PostgreSQL.                 |
| Buy / sell        | **PARTIAL** | `/shop` and API perform atomic catalog materialization/payment and unequipped half-value sales with validation.                           | Execute purchase/sale rollback and authorization regressions on clean PostgreSQL.         |
| Price lists       | **PARTIAL** | Source-enriched, idempotently seeded 20-entry core catalog stores price, weight, equipment, armor, shield, ranged, and provenance fields. | Execute `db:seed` and catalog idempotency tests on a freshly migrated database.           |
| Loot distribution | **PARTIAL** | Tiered deterministic planner plus ended-combat DM generation, participant-scoped view, transactional awards, API, and `/loot` exist.      | Execute DM/participant/quantity/distribution live regressions on clean PostgreSQL.        |
| Player trade      | **PARTIAL** | Persisted offer/accept/decline/cancel/expiry flow revalidates and locks funds/assets before an atomic swap; API and `/trade` exist.       | Execute concurrency, insufficient-funds, expiry, and ownership regressions on PostgreSQL. |

#### Armor and complete equipment

| Item                           | Status      | Current evidence                                                                                                                         | Acceptance criteria / remaining work                                         |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Armor table/items              | **PARTIAL** | Catalog-linked armor items persist RS/BE/value/weight/slot/equip state; CRUD, stack splitting, migration, API, and Discord UX exist.     | Execute clean migration and armor equip/conflict regressions.                |
| RS and BE                      | **PARTIAL** | Equipment synchronization derives total RS from natural plus worn armor and derives BE/load Belastung after every relevant mutation.     | Execute live derivation and legacy-RS migration regressions.                 |
| Armor slots                    | **PARTIAL** | Ten validated body slots replace conflicts atomically; seeded armor/clothing uses BODY/HEAD/BACK/HANDS/FEET.                             | Execute item stack-split and slot-conflict regressions.                      |
| Shield mechanics               | **PARTIAL** | Seeded shields carry shield technique, weight/value, AT modifier, and doubled active PA bonus per the local shield rule.                 | Execute shield purchase/equip/combat regressions on PostgreSQL.              |
| Encumbrance                    | **PARTIAL** | Armor BE plus excess carried weight derives Belastung, which affects AT/PA/initiative/GS/talent checks and incapacitates at IV.          | Execute combat/probe integration regressions with equipped armor/load.       |
| Carrying capacity              | **PARTIAL** | Gram-safe aggregation implements KK × 2 Stein capacity and one Belastung per full additional 4 Stein; `/equipment show` displays totals. | Execute inventory mutation and KK-change live regressions.                   |
| Clothing / non-armor equipment | **PARTIAL** | Catalog and custom items support CLOTHING/GEAR/CONSUMABLE types, values, weights, body slots, equip state, trade, sale, and loot.        | Execute catalog/custom-item integration regressions.                         |
| Equipment weight               | **PARTIAL** | Integer grams persist on items/weapons, aggregate by quantity, exclude only the one worn armor unit, and drive load state.               | Execute migration and aggregate-weight live regressions.                     |
| Full slot system               | **PARTIAL** | Body equipment uses ten validated slots; weapons/shields retain ADAPTIVE/OFFENSE/DEFENSE hand semantics and all surfaces expose state.   | Execute mixed equipment/weapon conflict and restart persistence regressions. |

### COMMAND_AUDIT reconciliation

| Item                        | Status      | Evidence / action                                                                                                                                     |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier 0 command naming       | **STALE**   | Actual commands are already `/create-character`, `/probe`, `/show-mob`, and `/edit-skills`; no rename is needed.                                      |
| Tier 1 CRUD gaps            | **DONE**    | `/edit-weapon`, `/edit-item`, and `/delete-mob` exist.                                                                                                |
| Tier 2 resources/conditions | **DONE**    | SchP, AsP, KaP, condition/status CRUD, regeneration, and displays exist; lifecycle/help gaps are tracked in their owning slices.                      |
| `/regel` availability       | **STALE**   | `commands/regel.js` and tests already exist despite older guidance saying the vector DB was not exposed.                                              |
| Loot / treasure tables      | **PARTIAL** | `/loot` and authenticated API implement tiered ended-combat pools, DM authorization, participant checks, and atomic awards; live DB proof is blocked. |
| Combat log command          | **PARTIAL** | `/combat-log` and `GET /combat/log` return the latest active or ended channel session; clean-DB integration remains unverified.                       |
| Maneuver library commands   | **PARTIAL** | `/list-maneuvers`, `/show-maneuver`, and `/api/maneuvers` reuse the seeded catalog; seeded live-DB verification remains blocked.                      |
| Tier 4                      | **BLOCKED** | Explicitly out of scope for this goal; no implementation will be attempted.                                                                           |

## Checkpoints, dependencies, and exit criteria

| Checkpoint                     | State       | Dependencies                                                                                   | Exit criteria                                                                                                                          |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Audit and ledger            | **DONE**    | Direct code/docs/schema/test inspection plus healthy structural/semantic Graphify evidence.    | Inventory classifies every in-scope item and reconciles stale roadmap/audit claims.                                                    |
| 1. Wounds and healing          | **BLOCKED** | Implementation and non-DB gates pass; isolated PostgreSQL remains unavailable.                 | Clean migration and live-DB combat/resource/treatment regressions are the only remaining wound-checkpoint evidence.                    |
| 2. Combat and status lifecycle | **BLOCKED** | Implementation/static gates pass; isolated PostgreSQL remains unavailable.                     | Clean migrations plus live combat/status/inventory regressions are the only remaining checkpoint evidence.                             |
| 3. Magic and Karma             | **BLOCKED** | Implementation and non-DB gates pass; isolated PostgreSQL remains unavailable.                 | Clean migration/seed plus live casting, duration, interruption, learning, and miracle regressions are the only remaining evidence.     |
| 4. Economy and equipment       | **BLOCKED** | Implementation and non-DB gates pass; isolated PostgreSQL remains unavailable.                 | Clean migration/seed plus wallet/shop/trade/loot/equipment authorization and transaction regressions are the only remaining evidence.  |
| 5. AP advancement              | **BLOCKED** | Implementation and non-DB gates pass; isolated PostgreSQL remains unavailable.                 | Clean migration/seed plus live AP grant, cost, cap, prerequisite, duplicate, and rollback regressions are the only remaining evidence. |
| 6. Final reconciliation        | **BLOCKED** | Roadmap/audit reconciliation and static gates pass; working Docker daemon remains unavailable. | Clean migration/seed execution and the full live integration pass are the only remaining stopping-condition evidence.                  |

## External blockers

- **Clean Docker database:** Docker CLI 28.3.3 is installed, but the default
  `npipe:////./pipe/docker_engine` endpoint does not exist and no Docker Desktop,
  Docker/Compose plugin or standalone Compose binary, Docker service, Podman,
  PostgreSQL server, local port-5432 listener, or WSL distribution is available.
  The configured `DATABASE_URL` is remote and is intentionally not used for tests
  or migrations. Code work and non-DB verification continue; clean migration/full
  integration evidence remains blocked until a local Docker daemon and Compose are
  available.
- **Blocked-audit recurrence:** The same missing local runtime has now been
  independently confirmed on the original goal turn and two consecutive goal
  continuations. No safe in-scope work can produce the required clean migration or
  live integration evidence without that external state change.

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
  persisted effect display, and active/ended `/combat-log` access.
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
  `0006_freezing_klaw.sql`; the seed now imports 467 executable magic entries
  and 363 executable karmic entries from the local Regelwiki export.
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
  migrated `/edit-skills` from free multi-assignment to the same AP-backed learning
  service, exposed AP on `/show-stats`, and updated command/help metadata.
- Generated `0008_new_mentor.sql` with catalog metadata, source-aligned maneuver AP
  costs, duplicate-safe unique ownership constraints, highest-FW preservation, and
  existing-character talent backfill. Documented mechanics and override boundaries
  in `docs/advancement-rules-decisions.md`.
- Added the 995-entry fixed-cost magical/karmic special-ability catalog, original
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
