# AGENTS.md

Guide for AI agents working in the DSANewBot codebase.

## Project Overview

A Discord bot for **DSA (Das Schwarze Auge) 5th Edition** tabletop RPG combat management. This bot handles character management, combat encounters, initiative tracking, and dice rolling for DSA 5e mechanics.

**Architecture**: Discord bot frontend + Supabase backend. The bot uses Supabase for database storage and Edge Functions for complex operations.

## Essential Commands

```bash
# Install dependencies
npm install

# Start the bot
node index.js

# Deploy slash commands globally (takes up to 1 hour to propagate)
node deploy-commands.js

# Deploy slash commands to specific guild (instant, for testing)
node deploy-commands.js guild
```

## Environment Variables

Create a `.env` file with:

- `DISCORD_TOKEN` - Bot token from Discord Developer Portal
- `CLIENT_ID` - Application ID from Discord Developer Portal
- `GUILD_ID` - Discord server ID (for guild command deployment)
- `SUPABASE_URL` - Supabase project URL (e.g., `https://yourproject.supabase.co`)
- `SUPABASE_ANON_KEY` - Supabase anonymous key from project settings
- `SUPABASE_SERVICE_KEY` - Supabase service role key (for DB writes / import scripts)
- `OPENAI_API_KEY` - OpenAI API key (for generating embeddings)

## Code Organization

```
/
├── index.js              # Entry point, client setup, command/event loading, interaction routing
├── deploy-commands.js    # Slash command registration script
├── commands/             # Slash command definitions (one file per command)
├── events/               # Discord event handlers
├── handlers/             # Business logic (combat, interactions)
├── utils/                # Utility functions (dice, components, rules search)
├── scripts/              # CLI tools (import, query, embed)
└── DSA5WikiScraper/      # Regelwiki scraper pipeline (Python)
```

## Key Patterns

### Command Structure

Every command module in `/commands` exports:

```javascript
module.exports = {
    data: new SlashCommandBuilder().setName('commandname').setDescription('Description'),
    async execute(interaction) {
        // Command logic
    },
    // Optional: autocomplete handler
    async autocomplete(interaction) {
        // Return filtered choices
    },
};
```

Related public operations use noun roots with subcommands (`/character`,
`/combat`, `/inventory`, `/weapon`, `/mob`, `/maneuver`, and `/casting`). The
legacy leaf modules remain internal handler implementations and are filtered by
`utils/commandRegistration.js`. Use `utils/delegatedCommand.js` when adding a
subcommand backed by an existing leaf handler. `/inventory`, `/inv`, and `/items`
are intentionally identical aliases.

### Interaction Handling Flow

1. `index.js` receives all interactions
2. Slash commands → routed to command's `execute()` via `client.commands` Collection
3. Message components (buttons/selects/modals) → routed by `customId` prefix:
    - `combat_`, `caa_`, `cas_`, `cet_`, `ctsa_`, etc. → `combatHandler.js`
    - `stat_select`, `edit_`, `exit_editor` → handled by `editStats.js` collector (ignored centrally)

### Combat CustomId Prefixes

| Prefix           | Handler                     | Purpose               |
| ---------------- | --------------------------- | --------------------- |
| `caa_`           | Combat Action Attack        | Player attack button  |
| `cas_`           | Combat Action Skill         | Player skill button   |
| `cet_`           | Combat End Turn             | Player end turn       |
| `ctsa_`          | Combat Target Select Attack | Target selection menu |
| `csm_`           | Combat Skill Maneuver       | Skill selection menu  |
| `dmnpc_action_*` | DM NPC controls             | DM controlling NPCs   |
| `join_combat_`   | Join combat button          | Players joining setup |
| `add_mob_`       | Add mob modal/submit        | DM adding NPCs        |
| `start_fight_`   | Start combat                | DM starting encounter |
| `park_combat_`   | Park session                | Pause combat          |
| `end_combat_`    | End session                 | Terminate combat      |

### Supabase Communication

- Database client via `@supabase/supabase-js` in `utils/supabaseClient.js`
- Direct table queries using `supabase.from('table_name')` for CRUD operations
- Edge Functions via `callEdgeFunction(functionName, payload)` for complex operations:
    - `create-player` - Creates player with stats, weapons, talents
    - `create-combatant` - Creates combatant in active session
    - `end-combat` - Ends combat session
    - `equip-weapon` - Updates weapon equipped status
    - `set-selected-player` - Sets active character for user

### In-Memory State

Combat sessions are cached in `client.activeCombats` (Map keyed by channelId):

```javascript
client.activeCombats.set(channelId, sessionData);
const session = client.activeCombats.get(channelId);
```

Session recovery on startup via `recoverActiveCombats()` fetches active/paused sessions from backend.

## DSA 5e Combat Mechanics

### Attack Resolution (`utils/combatUtils.js`)

1. **Attack Roll**: d20 vs attacker's AT (Attack Value)
    - Natural 1: Critical check (roll again, must succeed to confirm crit)
    - Natural 20: Botch check (roll again, must succeed or botch)
2. **Defense**: If hit, defender rolls d20 vs PA (Parry Value)
3. **Damage**: `parseAndRollDamage(tpString)` parses formats like `1w6`, `2w6+4`
4. **Soak**: `applySoak(damage, rs)` subtracts armor (RS = Rüstungsschutz)

### Damage String Format

Supports DSA notation: `XwY+Z` (X dice of Y sides plus Z bonus)

- `"1w6"` → 1d6
- `"2w6+4"` → 2d6+4
- Plain numbers treated as static damage

## Common Gotchas

1. **Interaction Acknowledgement**: Always use `deferReply()` for commands that make API calls, then `editReply()` to respond.

2. **Button/Select Menu Updates**: Use `deferUpdate()` for actions that don't need a visible response, then the main combat message is updated via `updateCombatDisplay()`.

3. **Ephemeral Message Cleanup**: Many confirmations auto-delete after 3-5 seconds:

    ```javascript
    setTimeout(() => {
        interaction.deleteReply().catch(err => {
            if (err.code !== 10008) console.error('...', err);
        });
    }, 3000);
    ```

4. **Component CustomId Length**: Discord limits customIds to 100 characters. Shortened prefixes are used to stay within limits.

5. **Emoji Format**: Use emoji objects, not strings:

    ```javascript
    .setEmoji({ name: '⚔️' })  // Correct
    .setEmoji('⚔️')            // May cause issues
    ```

6. **Collector vs Central Handler**: Some interactions (like editStats) use collectors that handle their own interactions. The central handler in `index.js` must NOT acknowledge these to avoid "interaction already acknowledged" errors.

7. **Maneuver Target Selection**: Skill/maneuver attacks are stateless — the maneuver id rides in the combat target select option's value as `targetId:maneuverId` (parsed in `handleCombatTargetSelectAttack`). Plain attacks send just `targetId`. No server-side nonce map is used.

## Adding New Commands

1. Extend the appropriate public root, or create a focused root in `/commands/`
2. Export `data` (SlashCommandBuilder) and `execute` function
3. For autocomplete: also export `autocomplete` function
4. Run `npm run test:commands`
5. Run `node deploy-commands.js guild` only when test-guild deployment is authorized
6. Run `node deploy-commands.js` only when global deployment is authorized

## Adding New Combat Interactions

1. Define customId prefix (keep short)
2. Add prefix check in `index.js` interaction handler
3. Add handler function in `handlers/combatHandler.js`
4. Export handler from combatHandler if needed elsewhere
5. Update `updateCombatDisplay()` if new buttons should appear on combat message

## Supabase Schema

Key database tables:

- `players` - Discord user characters (with `stats`, `weapons`, `items`, `player_talents`, `player_action_modifications` relations)
- `mobs` - NPC templates for combat
- `combat_sessions` - Combat encounter state
- `combatants` - Participants in a combat session
- `combatant_conditions` - Active conditions (Zustände) per combatant — leveled (Stufe I-IV), with duration tracking
- `combatant_statuses` - Active status effects per combatant — binary (on/off), with duration tracking
- `action_modifications` - Combat maneuvers/skills with modifiers
- `talents` - DSA talent definitions
- `rule_pages` - Canonical rule documents from Regelwiki scraper (7,196 pages)
- `rule_chunks` - Chunked rule text with vector embeddings for semantic search (10,426 chunks)
- `rule_documents` - **Legacy** single-table rule store (deprecated, kept for fallback)

## Rules Vector Database

The bot has a **pgvector-powered semantic search** system for looking up DSA 5e rules from the [Regelwiki](https://dsa.ulisses-regelwiki.de/). This is the knowledge base for all DSA rules, spells, talents, creatures, etc.

### How to Look Up a DSA Rule

**From CLI** (fastest way to check a rule):

```bash
node scripts/query-rules.js "Wie funktioniert eine Finte im Kampf"
node scripts/query-rules.js "Drache Kampfwerte"
node scripts/query-rules.js "Wundschwelle Schmerz"
```

**From code** (in bot commands/handlers):

```javascript
const { searchRules, getRulesByCategory, getRuleByTitle } = require('../utils/rulesClient');

// Semantic search — returns top matches with similarity scores
const results = await searchRules('bleeding damage rules', { limit: 3, threshold: 0.5 });

// Category lookup — returns all rules in a category
const spells = await getRulesByCategory('spells', 10);

// Exact title lookup
const rule = await getRuleByTitle('Finte I-III');
```

### Architecture

```
DSA5WikiScraper/dsa_scraper_v3/   →  Scrapes Regelwiki HTML, parses to JSON
  ↓ export_embeddings.py
data/embeddings/
  canonical_documents.jsonl        →  8,027 page-level documents
  chunks.jsonl                     →  11,370 text chunks for embedding
  ↓ scripts/import-rules-v3.js
Supabase
  rule_pages                       →  7,196 canonical documents (unresolved filtered)
  rule_chunks                      →  10,426 chunks with vector(1536) embeddings
  match_rule_chunks()              →  Semantic search RPC function
  ↓ utils/rulesClient.js
Bot runtime                        →  searchRules(), getRulesByCategory(), getRuleByTitle()
```

### Key Files

| File                              | Purpose                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `utils/rulesClient.js`            | Rules search API — `searchRules()`, `getRulesByCategory()`, `getRuleByTitle()` |
| `utils/ruleImportTransforms.js`   | Transforms scraper JSONL into Supabase row shapes                              |
| `scripts/import-rules-v3.js`      | Imports scraper output into Supabase + generates embeddings                    |
| `scripts/query-rules.js`          | CLI tool to test semantic search                                               |
| `scripts/embed-rules.js`          | Legacy markdown-based embedding script (deprecated)                            |
| `DSA5WikiScraper/dsa_scraper_v3/` | The scraper pipeline (Python)                                                  |
| `RULES_VECTOR_DB.md`              | Detailed architecture doc for the vector DB system                             |

### Embedding Model

- **Model**: `text-embedding-3-large` (OpenAI) with `dimensions: 1536`
- **Vector column**: `rule_chunks.embedding` — `vector(1536)` with HNSW index (cosine distance)
- **Search function**: `match_rule_chunks(query_embedding, match_threshold, match_count, filter_category, include_unresolved)`
- **Default threshold**: 0.5 similarity (scores typically range 0.55–0.70 for relevant matches)

### Re-importing Rules

After a new scraper run or to re-embed with a different model:

```bash
# Full import (reads JSONL, inserts pages+chunks, generates embeddings via OpenAI)
npm run import:rules

# Dry run to check counts without writing
node scripts/import-rules-v3.js --dry-run

# Include unresolved/ambiguous pages
node scripts/import-rules-v3.js --include-unresolved
```

### Current Integration Status

The rules search infrastructure is wired into the `/regel` Discord command and
authenticated rules API. Useful semantic results still depend on importing the
`rule_pages` and `rule_chunks` corpus into the target database.
