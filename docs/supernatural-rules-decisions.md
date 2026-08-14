# Supernatural Rules Decisions

This document records the implementation choices that connect DSANewBot's magic and Karma systems to the local DSA 5 rules data. It is the acceptance reference for the supernatural service, catalog seed, API, and Discord commands.

## Sources and catalog boundary

- Spell data comes from `DSA5WikiScraper/dsa_scraper_v3/data/json/magic.json`.
- Liturgy data comes from `DSA5WikiScraper/dsa_scraper_v3/data/json/götterwirken.json`.
- General behavior is based on the local Regelwiki rules entries `Liturgiewirken`, `Mirakel`, `Segen in Regeln`, `Aufbau der Liturgie- und Zeremoniebeschreibung`, and `Steigern von Eigenschaften, Talenten und Zaubern` in `rules.json`.
- The seed accepts spells, rituals, tricks, liturgies, ceremonies, and blessings. Rows missing a probe, resource rule, or tradition are excluded unless they are tricks or blessings, whose complete fixed rules are supplied by `Segen in Regeln` and the corresponding simple-magic convention. This prevents incomplete scraped rows from becoming free, automatic cast actions.
- The current local files yield 467 parsed magical rows (276 spells, 77 rituals, 114 tricks) and 363 parsed karmic rows (203 liturgies, 147 ceremonies, 13 blessings). Regelwiki URL aliases repeat some external IDs, so the canonical seed stores 461 magical and 353 karmic rules after collapsing only semantically identical aliases. A repeated ID with divergent mechanics fails the seed instead of silently replacing a rule. Seeding is idempotent by canonical external ID.
- Tricks and blessings cost 1 AsP or KaP, take one action, need no probe, and cost 1 AP to learn. The scraper omits those fixed fields, so the parser supplies them.
- A non-numeric, ability-specific resource rule is represented as a required caller-selected amount from 1 to 100. The original text remains in `raw_properties` for table adjudication.

## Learning and traditions

- A character configures magical tradition, blessed tradition, deity, and favored talents through one persisted supernatural profile.
- A learned ability must match the configured tradition. `Allgemein` entries are open to every matching power source; values such as `Peraine (Heilung)` match both the Peraine tradition and the stored aspect.
- Liturgies require both a blessed tradition and a deity. Spells require a matching magical tradition unless their distribution is general.
- Activation spends the catalog's advancement-column cost (A=1, B=2, C=3, D=4; tricks and blessings=1) and creates an immutable AP ledger entry in the same transaction as the learned ability. Raising the resulting FW is handled by the advancement service.

## Probes and resource costs

- Spell and liturgy probes use the catalog's three attributes and the learned FW. Wound penalties, persisted condition modifiers, and an explicit -20..20 situational modifier are applied through the shared 3d20 evaluator.
- Incapacitated characters and combatants barred from acting cannot cast or invoke miracles. In a running encounter, casting is restricted to the caster's turn and to targets in the same encounter. A paused encounter rejects casting.
- Successful casts pay the full selected AsP/KaP cost. Failed probes pay half, rounded up, and create a `FAILED` casting audit record without applying an effect.
- Permanent costs reduce both the maximum and the current pool on success. A failed cast does not pay a permanent cost.
- Variable healing spends at least 4 points and at most the learned FW (with 4 retained as the usable minimum at FW 0). Armatrutz accepts only 4, 8, or 16 AsP for RS 1, 2, or 3. Self-only effects reject another target.
- `Kleiner Heilsegen` is enforced once per target in a rolling 24-hour interval. The target stats row is locked before this check so simultaneous attempts cannot both apply.

## Extended castings and interruption

- An ability taking more than one action or any number of minutes becomes a persisted `PENDING` casting. The probe and resources are committed when the player begins it; this is the bot's asynchronous commitment boundary. Remaining actions use two seconds per action for the completion timestamp, while minute/hour durations use wall-clock time.
- Beginning a pending casting in combat creates a persisted concentration effect that bars other actions. Discord advances the initiating combat turn. Completing or cancelling the casting removes the concentration effect.
- Completion is owner-only, locked, cannot occur before `completes_at`, and applies the effect once. Repeated completion and cancellation attempts fail without additional mutation.
- Voluntary interruption keeps half the original cost, rounded up. The service implements this by refunding the other half atomically and recording `CANCELLED`, the refund, and retained cost. This matches the failed-casting resource rule used when concentration is abandoned.
- Damage-driven concentration checks remain a tabletop decision: after resolving the shared `Selbstbeherrschung (Störungen ignorieren)` roll, the owner uses completion or cancellation. The bot does not invent a modifier where the rules require situation-dependent GM judgment.

## Effects and duration

- Curated mechanical mappings cover damage (`Ignifaxius`, `Fulminictus`), resource-scaled healing (`Balsam Salabunde`, `Heilsegen`), one-per-day healing (`Kleiner Heilsegen`), armor (`Armatrutz`), and Paralysis. Every other accepted entry creates a persisted narrative `UTILITY` result from its Regelwiki effect text rather than returning an empty success.
- Damage uses the shared dice, armor, wound-threshold, LP synchronization, and incapacitation path. Fulminictus ignores mundane armor; Ignifaxius can add `Brennend` on the cataloged 1-3 on 1d6 result.
- Combat buffs, conditions, and statuses use the shared persisted effect tables. Round durations tick with combat lifecycle events and update their supernatural tracking record. Real-time durations expire by timestamp. One DSA minute is represented as 30 combat rounds when a time-based buff must participate in turn processing.
- Instant effects are retained as inactive audit records. Ongoing, permanent, and narrative effects remain discoverable through `/supernatural-effects` and the API.

## Miracles

- A miracle costs 4 KaP and requires a configured deity and blessed tradition.
- A favored talent miracle immediately rolls that learned talent at +2, including current wound and condition modifiers.
- AT/PA miracles require an owned combatant in a running encounter and an equipped combat technique listed among the deity's favored talents. AT must be invoked on the owner's turn. The +2 token is consumed by the next applicable attack or defense.
- Unused combat miracle tokens expire at the next round boundary, reflecting the rule that the bonus must be used immediately. A miracle is a free action, so invoking it does not advance the turn.

## Authorization and auditability

- All profile, learning, casting, completion, cancellation, effect-history, and miracle operations resolve the selected character from the authenticated Discord identity.
- Learned abilities, AP spending, resource changes, casting state, effect results, and tracked durations are transactional and persisted. Discord commands call the same services as the HTTP API.
