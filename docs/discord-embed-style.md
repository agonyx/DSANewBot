# Discord Presentation UX

## Audit scope and outcome

The August 2026 audit covered all 57 `EmbedBuilder` constructions in 43 runtime files. Embeds remain the best Discord-native display for summaries, record details, editors, combat state, and roll results. They preserve hierarchy, work with attachments and components, and remain readable on desktop and mobile.

The audit found four recurring defects:

- list fields and descriptions could exceed Discord limits or silently discard later results;
- inline columns produced narrow, hard-to-scan weapon and character layouts on mobile;
- colors, footers, progress bars, truncation, and empty states were implemented inconsistently;
- internal representations such as maneuver JSON and catalog UUIDs were exposed when a human-readable label or autocomplete already existed.

The implementation now routes every runtime embed through `utils/embedUtils.js`. Data-heavy views live in `utils/embedViews.js`, where they can be serialized and regression-tested without invoking Discord.

## Choosing a presentation

| Data shape                     | Presentation                             | Examples                                                   |
| ------------------------------ | ---------------------------------------- | ---------------------------------------------------------- |
| Short confirmation or error    | Plain ephemeral message                  | buy, sell, equip, learn                                    |
| Interactive detail or result   | Components V2                            | spell, liturgy, maneuver, resource change                  |
| Bounded interactive live state | Components V2                            | combat lobby, active combat, pending defense               |
| Non-interactive entity detail  | One embed with labeled fields            | mob, rule result, healing                                  |
| Variable-length list           | Numbered multi-embed response            | inventory, weapons, maneuvers, mobs, abilities, combat log |
| Long portable record           | Attachment with an embed/message summary | character export                                           |

Components V2 are preferred when interactive state benefits materially from
stronger grouping and controls: active combat, pending defense, supernatural
execution, and compact character resources. Plain text remains preferable for
short confirmations and errors; legacy embeds remain the fallback for simple
details, catalogs, and attachment summaries.

A Components V2 message must set `IS_COMPONENTS_V2` on its initial reply. That
flag is permanent, and the message cannot mix traditional `content` or `embeds`
with V2 components. A deferred interaction must therefore set the flag during
`deferReply`; later edits change only `components`.

Pure builders live in `utils/componentViews.js`. New combat lobbies, active
combat/turn state, pending defense, character sheets, AsP/KaP/SchP changes, and
spell/liturgy/maneuver details and results use those builders in production.
With development commands enabled, `/dev-ui-prototypes` renders six review
views for desktop and mobile screenshot review. Existing combat messages retain
their tested embed fallback because Discord does not allow an already-created
legacy message to acquire the permanent V2 flag. Catalogs, inventory, weapons,
party lists, and other paginated data remain embeds; short confirmations should
not become heavy cards.

Buttons and select menus remain the right companion for actions, but are not a replacement for the data itself. Interactive pagination was deliberately avoided: a command response can send up to ten prebuilt pages without maintaining collector state or expiring navigation controls. When a result would exceed ten pages, the final page explicitly says that more results exist and asks the user to refine the filter.

## Shared visual language

Use `createEmbed(theme)` instead of constructing `EmbedBuilder` directly. Themes have stable meaning:

| Theme                          | Meaning                              |
| ------------------------------ | ------------------------------------ |
| `neutral`, `info`              | help, utilities, neutral information |
| `success`, `warning`, `danger` | action/state outcome                 |
| `character`                    | sheet, abilities, advancement        |
| `combat`                       | combat, weapons, mobs, maneuvers     |
| `inventory`, `equipment`       | carried and equipped assets          |
| `economy`                      | wallets, catalogs, trade, loot       |
| `magic`, `karma`               | arcane and blessed systems           |
| `rules`                        | Regelwiki content                    |

The status icon and wording carry the meaning; color is supporting information and must never be the only signal.

## Layout rules

- Prefer a summary sentence followed by compact fields. Put the most actionable values first.
- Use `—` in titles and `·` between compact peer values. Avoid decorative emoji at both ends of a title.
- Use inline fields only for short peer metrics. Lists and multi-line records are full width for mobile readability.
- Show stable numeric owned-asset IDs because inventory, equipment, shop, and trade commands consume them. Do not show catalog UUIDs when autocomplete is the supported selection path.
- Use shared progress bars for bounded resources. Clamp invalid or over-maximum values before rendering.
- Use `buildListEmbeds` or `buildSectionEmbeds` for variable data. Never use `slice(0, 4096)` or `substring(0, 4096)` to silently discard records.
- Truncate only descriptive prose, with an ellipsis and a documented detail path. Do not truncate identifiers that the next command requires.
- Keep every payload within Discord's 256-character title, 4,096-character description, 1,024-character field value, 25-field, 6,000-character total, and 10-embed response limits.

## Key view decisions

- Inventory reports stacks, total units, and carried weight; uses canonical category order; keeps owned IDs; and safely splits category fields and pages.
- Weapons use full-width melee/ranged sections instead of competing inline columns. Each entry keeps the combat values, equipment state, weight, value, and owned ID needed for follow-up commands.
- The character sheet separates mental and physical attributes from vitals/wounds, combat/protection, and resource pools. FF/GE/KO/KK are no longer mislabeled as combat stats.
- Maneuver detail converts prerequisites and rules into labeled values rather than JSON code blocks.
- Catalogs, logs, mobs, learned abilities, supernatural activity, trades, and loot use safe list/section builders instead of fixed-row slices.
- One-line mutation confirmations intentionally remain plain ephemeral messages. Turning them into cards would add visual weight without making the information clearer.
- Free-form dice rolls use one compact inline breakdown (`notation → dice + modifier = total`) in message replies, `/roll`, and `/macro roll`; long pools show a bounded preview without hiding the total.

## Verification

`tests/embedUtils.test.js` covers limits, chunking, pagination, structured-data formatting, progress bars, and footers. `tests/embedViews.test.js` serializes representative and large inventory, weapon, character, maneuver, mob, and ability views and asserts Discord payload limits. `tests/combatComponents.test.js` verifies the shared semantic combat-lobby colors.
