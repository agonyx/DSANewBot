# Economy and Equipment Rules Decisions

This document records the mechanical choices used by the wallet, shop, equipment, trade, and loot systems. The implementation uses the local Regelwiki export as its rules source and keeps campaign-level choices explicit.

## Money and ledger

- Kreuzer is the stored base unit. `1 Dukat = 10 Silbertaler = 100 Heller = 1,000 Kreuzer`.
- Wallet balances may never be negative. Every change writes an immutable ledger row with the actor, category, reference, signed amount, and resulting balance.
- `/wallet adjust` is an owner-controlled tabletop override, not an unrestricted transfer endpoint. A reason is mandatory so manual campaign income and expenditure remain auditable.
- Shop sales return half the unit purchase value, rounded down before multiplying by quantity. This is the campaign default because the local source data does not define a universal resale rule.

## Catalog provenance

The local `ruestkammer_weapons.json`, `ruestkammer_equipment.json`, and `ruestkammer_armor.json` exports supply stable Regelwiki IDs, names, descriptions, categories, and source URLs. Those pages do not consistently expose price, weight, or the compact combat values required by the bot. `scripts/equipmentSeed.ts` therefore supplies a deliberately small core catalog with curated mechanical values and retains the source page properties in `raw_properties`.

Seeding is idempotent by the Regelwiki external ID (or a stable `curated_equipment_*` fallback). Extending the shop means adding a reviewed entry to that catalog, not scraping uncertain prose into live mechanics.

## Carrying capacity and Belastung

The local Regelwiki rule `rules_Tragkraft_und_Stemmen` states:

- normal carrying capacity is `KK × 2 Stein`;
- each full additional `4 Stein` causes one level of Belastung.

The bot stores weight in grams and treats one Stein as one kilogram. Worn armor weight is excluded from carrying-load Belastung, as specified by `docs/conditions-reference.md`; the armor's own BE still applies. Derived Belastung is capped at level IV.

Belastung affects AT, defense, initiative, movement, and affected talent checks. Level IV bars actions through the shared condition engine. `Selbstbeherrschung` wound-effect checks and supernatural casting checks ignore Belastung, matching the explicit exception in the local condition reference. Because the current talent catalog does not store the Regelwiki per-talent “Belastung” flag, other `/probe` talent checks conservatively apply it; adding that catalog flag is the correct future refinement.

## Armor and equipment slots

- Body equipment uses `HEAD`, `BODY`, `ARMS`, `HANDS`, `LEGS`, `FEET`, `BACK`, `WAIST`, `NECK`, and `ACCESSORY` slots. Equipping an item replaces the prior item in the same slot.
- A stack is split when one unit is equipped, so carried quantities, sale/trade authorization, weight, and armor values remain coherent.
- Equipped item RS is added to `stats.natural_armor`; equipped item BE is added to carrying-load Belastung. `stats.ruestungsschutz` and `stats.belastung` are derived values and are recalculated whenever relevant inventory or KK changes.
- Migration `0007` copies the pre-existing `ruestungsschutz` into `natural_armor` before equipment starts deriving the total. This preserves existing characters instead of silently deleting their protection.
- The implementation uses aggregate armor rather than the optional hit-zone armor focus rule. Hit zones still drive wound effects, but armor soak is intentionally a single character value.

## Weapons and shields

Weapon hand slots remain `ADAPTIVE`, `OFFENSE`, and `DEFENSE`. The local Regelwiki entry `rules_Parierwaffen_und_Schilde` says a shield's PA bonus is doubled when actively parrying with the shield technique; seeded shields therefore materialize with their active PA value including twice `shield_pa_bonus`. Passive multi-weapon shield bonus selection is not added a second time by the combat resolver.

Weapons retain price, weight, combat technique, ranges, reload duration, and hand requirement when bought, looted, or traded. Only equipped weapons can be selected for attacks.

## Trades

- Trades may exchange non-negative currency and up to ten item/weapon assets per side.
- Creation validates an ownership snapshot but does not reserve assets or funds. Acceptance locks and revalidates both wallets and every asset, then applies the entire swap in one database transaction. A changed balance, missing quantity, newly equipped asset, expiration, or concurrent resolution rejects the whole acceptance without partial transfer.
- Equipped assets must be unequipped before they can be offered or transferred.
- The recipient alone may accept or decline; the initiator alone may cancel. Offers expire after 72 hours by default (configurable from 1–168 hours).

## Post-combat loot

- Only the encounter DM may generate, award, or cancel loot. Generation requires an ended combat; viewing is limited to the DM and encounter participants. Awards can target only a selected character that participated in that encounter.
- Tiers 1–3 generate respectively one, two, or three distinct eligible catalog entries plus increasing currency bands. Tier value caps keep low-tier pools from selecting high-value armor and weapons. These bands are campaign defaults rather than claims of a universal DSA treasure table.
- Currency and catalog quantities remain in an open pool until awarded. Awarding is transactional and uses the same wallet ledger and catalog-materialization paths as the shop. A pool becomes `DISTRIBUTED` only when both currency and all entry quantities reach zero.
