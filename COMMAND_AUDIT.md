# Discord Command Surface Audit

Last audited: 2026-08-14

## Outcome

The production bot registers 36 top-level slash commands. Development mode adds
`/dev-test-character` and `/dev-test-mobs` for a total of 38. The legacy leaf
command modules remain as internal handler implementations, but they are not
registered with Discord.

The naming model is:

- Use a stable noun as the root for related operations (`/character`, `/combat`,
  `/weapon`, `/mob`, `/maneuver`, `/casting`).
- Use subcommands for CRUD and lifecycle verbs (`add`, `list`, `edit`, `delete`,
  `start`, `pause`, and so on).
- Keep established DSA resource terms and focused workflows as standalone roots
  (`/asp`, `/kap`, `/probe`, `/regel`, `/advance`).
- Name standalone rolls `/attack-check` and `/evade-check` so they are not
  confused with tracked combat actions.
- Treat `/inventory` as canonical and register `/inv` and `/items` as complete,
  behaviorally identical aliases.

## Consolidated command families

| Root                           | Subcommands                                                                      | Replaces registered leaf names                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/character`                   | `create`, `select`, `sheet`, `edit`, `export`, `avatar`, `delete`, `restore-lep` | `/create-character`, `/choose-character`, `/show-stats`, `/edit-stats`, `/export-character`, `/upload-avatar`, `/delete-character`, `/heal` |
| `/combat`                      | `start`, `end`, `pause`, `resume`, `log`                                         | `/start-combat`, `/end-combat`, `/park-combat`, `/resume-combat`, `/combat-log`                                                             |
| `/inventory`, `/inv`, `/items` | `add`, `list`, `edit`, `remove`, `use`                                           | `/add-item`, `/show-items`, `/edit-item`, `/remove-item`, `/use-item`                                                                       |
| `/weapon`                      | `add`, `list`, `edit`, `equip`, `delete`                                         | `/add-weapon`, `/show-weapons`, `/edit-weapon`, `/equip-weapon`, `/delete-weapon`                                                           |
| `/mob`                         | `add`, `list`, `show`, `edit`, `delete`                                          | `/add-mob`, `/list-mobs`, `/show-mob`, `/edit-mob`, `/delete-mob`                                                                           |
| `/maneuver`                    | `list`, `show`, `use`                                                            | `/list-maneuvers`, `/show-maneuver`, `/use-skill`                                                                                           |
| `/casting`                     | `status`, `complete`, `cancel`                                                   | `/supernatural-effects`, `/complete-casting`, `/cancel-casting`                                                                             |
| `/ability`                     | `list`                                                                           | `/show-skills`                                                                                                                              |
| `/attack-check`                | leaf command                                                                     | `/attack`                                                                                                                                   |
| `/evade-check`                 | leaf command                                                                     | `/evade`                                                                                                                                    |

`/edit-skills` is no longer registered. `/advance special` is the single
AP-backed special-ability learning path.

## Intentional distinctions

- `/character restore-lep` is a manual sheet/DM correction; `/inventory use` is
  the in-game consumable workflow and consumes an owned item.
- `/attack-check` and `/evade-check` are standalone rolls outside the persistent
  encounter flow. Tracked combat attacks and defenses remain button/action driven.
- `/equipment` manages worn gear, armor, load, and encumbrance. The inventory
  aliases manage carried item stacks. `/weapon` manages the legacy weapon records.
- `/condition`, `/status`, and `/effect` represent different persisted mechanics:
  leveled conditions, binary statuses, and numeric/narrative buffs or debuffs.

## Current production inventory

### Character and resources (7)

- `/character`
- `/advance`
- `/schicksalspunkte`
- `/asp`
- `/kap`
- `/regeneration`
- `/treat-wounds`

### Combat and effects (7)

- `/combat`
- `/combat-action`
- `/attack-check`
- `/evade-check`
- `/condition`
- `/status`
- `/effect`

### Equipment, inventory, and economy (9)

- `/inventory`
- `/inv`
- `/items`
- `/weapon`
- `/equipment`
- `/wallet`
- `/shop`
- `/trade`
- `/loot`

### Skills, rules, and utility (7)

- `/ability`
- `/maneuver`
- `/probe`
- `/regel`
- `/help`
- `/roll`
- `/macro`

### Magic and Karma (5)

- `/casting`
- `/spells`
- `/liturgies`
- `/tradition`
- `/miracle`

### Mob management (1)

- `/mob`

`/mob add`, `/mob edit`, and `/mob delete` require Manage Server permission at
execution time. `/mob list` and `/mob show` remain available to players.

## Roadmap reconciliation

| Earlier audit item          | Current status   | Evidence                                                                                                  |
| --------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| Tier 0 naming               | **DONE**         | Canonical roots and standalone check names are registered; legacy names are filtered centrally.           |
| Tier 1 CRUD gaps            | **DONE**         | `/weapon edit`, `/inventory edit`, and `/mob delete` delegate to the completed implementations.           |
| Tier 2 resources/conditions | **DONE**         | SchP, AsP, KaP, condition/status/effect CRUD, regeneration, and displays remain independently registered. |
| `/regel` availability       | **DONE**         | `/regel` remains registered and tested.                                                                   |
| Loot / treasure tables      | **DONE**         | `/loot` remains the focused post-combat reward workflow.                                                  |
| Combat logs                 | **DONE**         | `/combat log` delegates to the active/ended channel log implementation.                                   |
| Maneuver library            | **DONE**         | `/maneuver list` and `/maneuver show` reuse the seeded catalog; `/maneuver use` runs learned maneuvers.   |
| Nice-to-Have / Tier 4       | **OUT OF SCOPE** | No deferred product feature was added as part of the naming cleanup.                                      |

## Verification contract

`utils/commandRegistration.js` is the single registration policy used by runtime
startup and deployment. `utils/delegatedCommand.js` copies each leaf command's
live Discord option metadata and delegates execution/autocomplete without
duplicating business logic. `npm run test:commands` validates the family trees,
the three identical inventory aliases, legacy/dev filtering, unique registered
names, and the exact production/development counts. `tests/commandRouting.test.js`
covers option copying, execution, autocomplete, authorization hooks, renames, and
registration policy.
