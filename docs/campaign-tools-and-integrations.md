# Campaign tools and integrations

The campaign toolkit is guild-scoped and requires Discord **Manage Server** permission. OAuth API callers receive the same authorization for guilds where Discord reports Manage Server or Administrator permission.

## Campaign command

`/campaign` groups the DM-owned features:

- `quest add|list|show|objective|mark|status|delete` maintains quests and up to 25 objectives per quest.
- `npc generate` creates a ready-to-use random NPC name, role, motive, personality, and quick combat statistics.
- `encounter create|add|roll|list|show|delete` maintains weighted random encounter tables.
- `world show|set|advance|weather` stores one canonical ISO world clock and weather description per server.
- `map add|list|delete` stores named HTTPS map links.
- `stronghold add|list|update|delete` tracks bases, locations, descriptions, and development levels.
- `faction add|list|standing|delete` defines factions and lets a DM assign standing from -100 to 100 to an enrolled party character.
- `alchemy recipe-add|recipe-list|recipe-delete` maintains the recipe catalog used by `/alchemy`.
- `webhook add|list|delete|test` manages signed outbound HTTPS events. Endpoint URLs are redacted in list output.
- `backup create|restore` exports or restores campaign records and world state. Webhook URLs are deliberately excluded.

Restore defaults to merge/upsert behavior. Replace mode deletes the server's existing campaign records and world state inside one database transaction and therefore requires `confirm:true`.

## Character extensions

- `/companion add|list|update|delete` stores familiars, general companions, mounts, and riding animals for the selected character.
- `/background set|show` stores culture, profession, and optional background notes.
- `/reputation` shows the selected character's faction standings. DMs change standings with `/campaign faction standing`; the target must have joined `/party` in that server.
- `/crafting start|list|progress|cancel` tracks bounded crafting projects and automatically marks them complete at their target.
- `/alchemy recipes|brew|list|progress|cancel` turns campaign recipes into character-owned brewing projects.

## Character imports

`/character import` accepts a Discord-hosted JSON attachment up to 2 MB. The importer recognizes:

- Foundry VTT Actor JSON produced by the official DSA5 game system;
- Optolith's published character interchange shape;
- `dsanewbot-character-v1` JSON for direct integrations.

Only supported attributes, core resources, initiative, dodge, culture, and profession are imported. Unknown fields are ignored. Values are validated before database writes, and a failed import removes its partially created character.

## API

The authenticated API exposes the same service layer:

- `/api/campaigns/:guildId/records`
- `/api/campaigns/:guildId/world`
- `/api/campaigns/:guildId/backup` and `/restore`
- `/api/campaigns/:guildId/webhooks`
- `/api/character-records`
- `/api/characters/import`

Discord OAuth requests the `identify guilds` scopes. The resulting JWT contains only the caller ID and the guild IDs where the caller can manage the server; services still enforce the requested guild boundary.

## Signed webhooks and Dice So Nice

Set `WEBHOOK_SIGNING_SECRET` before delivery. Every request includes:

- `x-dsanewbot-event`
- `x-dsanewbot-signature: sha256=<HMAC-SHA256 of the exact request body>`
- a JSON body with `id`, `type`, `createdAt`, `guildId`, and `data`

Supported subscriptions are `dice.roll`, `campaign.updated`, `character.imported`, or `*`. Delivery uses HTTPS only, rejects credentials, redirects, local/private targets, and private DNS resolutions, and times out after five seconds. Failures never roll back the game action and endpoint URLs are never logged.

`/roll animated:true` publishes a `dice.roll` event. Its `data.dsnData` is already shaped for the official Dice So Nice custom-roll API:

```js
await game.dice3d.show(event.data.dsnData, game.user, true);
```

The configured webhook receiver or relay is responsible for verifying the signature and forwarding the event into the Foundry client runtime. Dice So Nice is a Foundry module—not a Discord renderer—so the animation appears in the connected Foundry table. See the [official Dice So Nice Roll API](https://riccisi.gitlab.io/foundryvtt-dice-so-nice/api/roll/).

## Storage

- `campaign_records` stores typed guild content (`QUEST`, `ENCOUNTER_TABLE`, `MAP`, `STRONGHOLD`, `FACTION`, and `ALCHEMY_RECIPE`).
- `campaign_worlds` stores the canonical server clock and weather.
- `character_records` stores selected-character extensions.
- `webhook_subscriptions` stores outbound integration configuration and is excluded from backups.
