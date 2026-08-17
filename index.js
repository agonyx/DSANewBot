// Load environment variables and Discord client
require('dotenv').config();
const { Client, Events, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./utils/logger');
const { shouldRegisterCommand } = require('./utils/commandRegistration');
const { selectCharacter, listCharacters } = require('./services/characters');
const log = createLogger('index');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.GuildMember, Partials.User, Partials.Message],
});

// Command handling
client.commands = new Collection();
client.activeCombats = new Map();
client.rulePageTitleCache = [];

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command && shouldRegisterCommand(command.data.name)) {
        client.commands.set(command.data.name, command);
    } else if (!('data' in command) || !('execute' in command)) {
        log.warn({ file: filePath }, 'Command missing required "data" or "execute" property');
    }
}

// Event handling
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.existsSync(eventsPath) ? fs.readdirSync(eventsPath).filter(file => file.endsWith('.js')) : [];

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

const combatHandler = require('./handlers/combatHandler'); // Assuming CommonJS
const { db, callEdgeFunction } = require('./db');
const { eq, inArray } = require('drizzle-orm');
const { combatSessions, combatants, players } = require('./db/schema');
const { sessionToMemory } = require('./utils/transforms');
const { getRulePageTitles } = require('./utils/rulesClient');
const { loadEffectsForCombatants } = require('./services/combatEffects');

const RULE_PAGE_CACHE_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Refreshes the rule page title cache. Preserves existing cache on failure.
 * @param {Client} client The Discord client instance.
 */
async function refreshRulePageTitleCache(client) {
    try {
        const titles = await getRulePageTitles();
        client.rulePageTitleCache = titles;
        log.info({ count: titles.length }, 'Refreshed rule page title cache');
    } catch (error) {
        log.error({ error: error.message }, 'Failed to refresh rule page title cache, preserving existing cache');
    }
}

/**
 * Recovers active or paused combat sessions from the database on bot startup.
 * @param {Client} client The Discord client instance.
 */
async function recoverActiveCombats(client) {
    log.info('Starting active combat session recovery...');
    try {
        // Fetch sessions that are RUNNING or PAUSED, then their combatants (2 queries).
        const sessions = await db
            .select()
            .from(combatSessions)
            .where(inArray(combatSessions.state, ['RUNNING', 'PAUSED']));

        if (!sessions.length) {
            log.info('No active or paused sessions found to recover');
            return;
        }

        const allCombatants = await db
            .select()
            .from(combatants)
            .where(
                inArray(
                    combatants.session_id,
                    sessions.map(s => s.id)
                )
            );
        const effectState = await loadEffectsForCombatants(allCombatants.map(combatant => combatant.id));
        const combatantsBySession = new Map();
        for (const c of allCombatants) {
            c.conditions = effectState.get(c.id)?.conditions || [];
            c.statuses = effectState.get(c.id)?.statuses || [];
            c.effects = effectState.get(c.id)?.effects || [];
            if (!combatantsBySession.has(c.session_id)) combatantsBySession.set(c.session_id, []);
            combatantsBySession.get(c.session_id).push(c);
        }

        log.info({ count: sessions.length }, 'Found sessions to recover');

        for (const session of sessions) {
            if (!session.channel_id || !session.id) {
                log.warn({ session }, 'Skipping session with missing channel_id or id');
                continue;
            }

            // Attach combatants (snake_case) so sessionToMemory can map them.
            session.combatants = combatantsBySession.get(session.id) || [];

            // Convert snake_case to camelCase for in-memory compatibility
            const memorySession = sessionToMemory(session);

            // Add the session back to the in-memory map
            client.activeCombats.set(session.channel_id, memorySession);
            log.info({ sessionId: session.id, channelId: session.channel_id }, 'Loaded session into memory');

            // Refresh the combat display to make buttons interactive again
            try {
                await combatHandler.updateCombatDisplay(client, session.channel_id, memorySession);
                log.info({ sessionId: session.id }, 'Successfully refreshed display');
            } catch (displayError) {
                log.error(
                    { sessionId: session.id, channelId: session.channel_id, error: displayError },
                    'Failed to update display'
                );
                // If the message or channel was deleted, we should remove it from memory
                client.activeCombats.delete(session.channel_id);
            }
        }
        log.info('Finished combat session recovery');
    } catch (error) {
        log.error({ error: error.message }, 'Could not fetch or process active combat sessions');
    }
}

client.on(Events.InteractionCreate, async interaction => {
    // --- Handle Autocomplete ---
    if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command || !command.autocomplete) {
            return;
        }
        try {
            await command.autocomplete(interaction);
        } catch (error) {
            log.error({ command: interaction.commandName, error }, 'Error in autocomplete');
        }
        return;
    }

    // --- Handle String Select Menu (from events/interactionsCreate.js) ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'select-character') {
        const selectedPlayerId = interaction.values[0];
        const discordId = interaction.user.id;

        try {
            await selectCharacter({ discordId }, Number(selectedPlayerId));

            const characters = await listCharacters({ discordId });
            const selected = characters.find(c => c.id === Number(selectedPlayerId));

            await interaction.update({
                content: `You have selected the character: ${selected?.name ?? 'Unknown'}.`,
                components: [],
            });
        } catch (error) {
            log.error({ error }, 'Error selecting character');
            await interaction.update({
                content: 'An error occurred while selecting your character. Please try again later.',
                components: [],
            });
        }
        return;
    }

    // --- Handle Slash Commands ---
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            log.error({ command: interaction.commandName }, 'No command matching was found');
            try {
                await interaction.reply({ content: `Command not found: ${interaction.commandName}`, ephemeral: true });
            } catch (e) {
                log.error({ error: e }, 'Error replying about missing command');
            }
            return;
        }
        try {
            await command.execute(interaction);
        } catch (error) {
            log.error({ command: interaction.commandName, error }, 'Error executing command');
            const replyOptions = { content: 'There was an error while executing this command!', ephemeral: true };
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions);
                } else {
                    await interaction.reply(replyOptions);
                }
            } catch (replyError) {
                log.error({ command: interaction.commandName, error: replyError }, 'Failed to send error reply');
            }
        }
    }
    // --- Handle Components (Buttons, Selects, Modals) ---
    else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        // Combined check for components/modals
        const customId = interaction.customId;

        if (interaction.isButton() && customId.startsWith('charimp_')) {
            try {
                await require('./commands/import-character').handleImportButton(interaction);
            } catch (error) {
                log.error({ error }, 'Character import confirmation failed');
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'Character import confirmation failed.', ephemeral: true });
                }
            }
            return;
        }

        // --- Check for Combat Prefixes ---
        if (
            customId.startsWith('combat_') ||
            customId.startsWith('join_combat_') ||
            customId.startsWith('add_mob_') || // Catches modal trigger and submit
            customId.startsWith('start_fight_') ||
            customId.startsWith('cancel_combat_') ||
            customId.startsWith('caa_') ||
            customId.startsWith('cad_') ||
            customId.startsWith('cact_') ||
            customId.startsWith('cabil_') ||
            customId.startsWith('cabt_') ||
            customId.startsWith('ctw_') ||
            customId.startsWith('cop_') ||
            customId.startsWith('cret_') ||
            customId.startsWith('cretopp_') ||
            customId.startsWith('cmodal_') ||
            customId.startsWith('cas_') ||
            customId.startsWith('cet_') ||
            customId.startsWith('csm_') || // Combat Skill Maneuver
            customId.startsWith('dmnpc_action') ||
            customId.startsWith('ctsa_') ||
            customId.startsWith('cts_npc_') ||
            customId.startsWith('npc_skill_pick_') ||
            customId.startsWith('npc_skill_target_') ||
            customId.startsWith('leave_setup_') ||
            customId.startsWith('manage_participants_') ||
            customId.startsWith('remove_participant_select_') ||
            customId.startsWith('select_char_join_') ||
            customId.startsWith('park_combat_') ||
            customId.startsWith('end_combat_') ||
            customId.startsWith('resume_session_select') ||
            customId.startsWith('show_full_log_')
        ) {
            // Route to appropriate combat handler function
            log.debug({ customId }, 'Routing combat interaction to combatHandler');
            try {
                if (interaction.isButton()) await combatHandler.handleCombatButton(interaction);
                else if (interaction.isStringSelectMenu()) await combatHandler.handleCombatSelectMenu(interaction);
                else if (interaction.isModalSubmit()) await combatHandler.handleCombatModalSubmit(interaction);
            } catch (error) {
                log.error({ customId, error }, 'Error during combat interaction processing');
                // Attempt to inform user if possible
                if (!interaction.replied && !interaction.deferred && interaction.isRepliable()) {
                    try {
                        await interaction.reply({
                            content: 'An error occurred processing this combat action.',
                            ephemeral: true,
                        });
                    } catch (e) {
                        log.error({ error: e }, 'Failed to send combat interaction error reply');
                    }
                }
            }
        }
        // --- Check for EditStats Prefixes/IDs (and DO NOTHING centrally) ---
        else if (
            customId === 'stat_select' ||
            customId === 'exit_editor' ||
            customId === 'select-character' ||
            customId === 'skill_select_menu' ||
            customId === 'confirm_skill_selection' ||
            customId.startsWith('edit_') ||
            customId.startsWith('edititem_') ||
            customId.startsWith('editweapon_')
        ) {
            // *** Explicitly ignore these IDs in the central handler ***
            log.debug({ customId }, 'Ignoring interaction in central handler (handled by specific command)');
            // IMPORTANT: No reply, deferUpdate, or other acknowledgement here!
            // Let the collector/listener in edit-stats.js handle it.
        }
        // --- Handle Other/Unknown Components ---
        else {
            log.warn({ customId }, 'Unhandled component interaction ID in central handler');
            // Do not acknowledge unless you have a specific reason for centrally handling unknown components.
        }
    }
    // Add other top-level interaction type handlers if needed (e.g., Context Menus)
});

// Event listener for when the client is ready
client.once(Events.ClientReady, async readyClient => {
    log.info({ tag: readyClient.user.tag }, 'Ready! Logged in');

    // Initialize rule page title cache (non-blocking)
    refreshRulePageTitleCache(readyClient).catch(err => {
        log.error({ error: err.message }, 'Initial rule page title cache load failed');
    });

    // Schedule periodic cache refresh every 15 minutes
    setInterval(() => {
        refreshRulePageTitleCache(readyClient).catch(err => {
            log.error({ error: err.message }, 'Scheduled rule page title cache refresh failed');
        });
    }, RULE_PAGE_CACHE_REFRESH_MS);

    await recoverActiveCombats(readyClient);
});

// Optional HTTP server (Hono) for /health + /ready probes and a future API seam.
// Guarded so the bot can still boot without DATABASE_URL during the Supabase→Postgres
// transition. Phase 3 removes this guard once Supabase is fully removed.
if (process.env.DATABASE_URL) {
    try {
        const { startServer } = require('./server');
        startServer();
    } catch (err) {
        log.error({ error: err.message }, 'Failed to start HTTP server');
    }
} else {
    log.warn('DATABASE_URL not set — Drizzle layer + HTTP server disabled (still using Supabase).');
}

client.login(process.env.DISCORD_TOKEN);
