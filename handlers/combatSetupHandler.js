/**
 * Combat Setup Handler
 * Handles all interactions during the SETUP phase of combat:
 * - Joining/leaving combat
 * - Adding mobs
 * - Managing participants
 * - Starting/cancelling combat
 */

const {
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');

const { db, callEdgeFunction } = require('../db');
const { eq, and } = require('drizzle-orm');
// `stats` is aliased to `statsTable` because the original handler already declares a
// local `const stats = ...` inside handleJoinCombatInteraction; importing it unaliased
// would put that line in the temporal-dead-zone of the inner binding and break the query.
const { players, stats: statsTable, mobs, combatSessions, combatants } = require('../db/schema');
const { createSetupEmbed, createSetupActionRows } = require('../utils/combatComponents');
const { createLogger } = require('../utils/logger');
const { beginCombat } = require('../services/combat');

const log = createLogger('combat-setup');

/**
 * Handles the "Join Combat" button click.
 */
async function handleJoinCombatInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Join Combat');
    await interaction.deferUpdate({ ephemeral: true });

    const discordId = interaction.user.id;

    try {
        log.debug({ discordId }, 'Fetching selected character');
        const [character] = await db
            .select()
            .from(players)
            .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')))
            .limit(1);

        if (!character) {
            log.warn({ discordId }, 'Could not retrieve selected character');
            await interaction.followUp({
                content: '❌ No character selected. Use `/choosecharacter` first.',
                ephemeral: true,
            });
            return;
        }

        const [statsRow] = await db.select().from(statsTable).where(eq(statsTable.player_id, character.id)).limit(1);
        character.stats = statsRow || null;

        const stats = Array.isArray(character.stats) ? character.stats[0] : character.stats;
        if (!stats) {
            await interaction.followUp({
                content: '❌ Your selected character data is missing required stats information.',
                ephemeral: true,
            });
            return;
        }
        character.stats = stats;

        log.debug({ characterId: character.id, sessionId }, 'Adding combatant player');
        await addCombatantPlayer(interaction, sessionId, character);
    } catch (error) {
        log.error({ error: error.message, sessionId, discordId }, 'Error in handleJoinCombatInteraction');
        const errorMessage =
            error instanceof Error ? `❌ Error: ${error.message}` : 'An error occurred while trying to join.';
        await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
}

/**
 * Helper function to add a player combatant via Edge Function and update setup message.
 */
async function addCombatantPlayer(interaction, sessionId, player) {
    if (!player || !player.stats) {
        log.error({ player }, 'addCombatantPlayer: invalid player data');
        await interaction
            .followUp({ content: '❌ Character data is invalid or missing stats.', ephemeral: true })
            .catch(() => {});
        return;
    }

    const maxHpField = 'le_max';
    const currentHpField = 'le_current';
    const initBaseField = 'initiative';
    const requiredStats = [maxHpField, currentHpField, initBaseField];

    for (const stat of requiredStats) {
        if (player.stats[stat] === undefined || player.stats[stat] === null) {
            log.error({ playerId: player.id, missingStat: stat }, 'Player missing required stat');
            await interaction
                .followUp({ content: `❌ Character is missing required stat '${stat}'.`, ephemeral: true })
                .catch(() => {});
            return;
        }
    }

    try {
        const combatantData = {
            sessionId,
            type: 'PLAYER',
            allegiance: 'PLAYER_SIDE',
            playerId: player.id,
            discordUserId: player.discord_id,
            name: player.name,
            maxHp: player.stats[maxHpField],
            currentHp: player.stats[currentHpField],
            initiativeBase: player.stats[initBaseField],
        };

        log.debug({ combatantData }, 'Calling create-combatant Edge Function');
        const { data, status, error } = await callEdgeFunction('create-combatant', combatantData);

        if (!error && (status === 200 || status === 201)) {
            log.info({ sessionId, playerName: player.name }, 'Combatant added successfully');
            await updateSetupMessage(interaction.client, sessionId);
        } else {
            log.error({ status, error: error?.message }, 'Failed to add combatant');
            await interaction.followUp({
                content: `❌ Failed to add: ${error?.message || 'Unknown error'}.`,
                ephemeral: true,
            });
        }
    } catch (error) {
        log.error({ error: error.message, sessionId, playerId: player.id }, 'Error in addCombatantPlayer');
        const errorMessage =
            error instanceof Error ? `❌ Error: ${error.message}` : 'An error occurred adding you to combat.';
        await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
}

/**
 * Updates the setup message after participant changes.
 */
async function updateSetupMessage(client, sessionId) {
    try {
        log.debug({ sessionId }, 'Fetching session for setup message update');
        const [updatedSession] = await db
            .select()
            .from(combatSessions)
            .where(eq(combatSessions.id, sessionId))
            .limit(1);

        if (!updatedSession) {
            log.error({ sessionId }, 'Failed to fetch updated session');
            return;
        }

        const sessionCombatants = await db.select().from(combatants).where(eq(combatants.session_id, sessionId));
        updatedSession.combatants = sessionCombatants;

        if (updatedSession?.message_id && updatedSession?.combatants) {
            const channel = await client.channels.fetch(updatedSession.channel_id).catch(() => null);
            if (!channel?.isTextBased()) {
                log.warn({ channelId: updatedSession.channel_id }, 'Channel not found or not text-based');
                return;
            }

            const originalMessage = await channel.messages.fetch(updatedSession.message_id).catch(() => null);
            if (!originalMessage) {
                log.warn({ messageId: updatedSession.message_id }, 'Original message not found');
                return;
            }

            const dmUser = await client.users.fetch(updatedSession.dm_user_id).catch(() => null);
            const dmUsername = dmUser ? dmUser.username : updatedSession.dm_user_id;

            // Compute readiness: at least 1 player AND 1 hostile, minimum 2 total
            const hasPlayers = updatedSession.combatants?.some(c => c.allegiance === 'PLAYER_SIDE');
            const hasHostiles = updatedSession.combatants?.some(c => c.allegiance === 'HOSTILE');
            const canStart =
                updatedSession.state === 'SETUP' && updatedSession.combatants?.length >= 2 && hasPlayers && hasHostiles;

            const newEmbed = createSetupEmbed(sessionId, dmUsername, updatedSession.combatants, canStart);
            const newActionRows = createSetupActionRows(sessionId, canStart);

            await originalMessage.edit({
                embeds: [newEmbed],
                components: newActionRows,
            });
            log.info({ sessionId, canStart }, 'Setup message updated');
        }
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Failed to update setup message');
    }
}

/**
 * Handles the "Leave Setup" button click.
 */
async function handleLeaveSetupInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Leave Setup');
    await interaction.deferUpdate({ ephemeral: true });

    const discordId = interaction.user.id;

    try {
        const [data] = await db
            .select()
            .from(combatants)
            .where(and(eq(combatants.session_id, sessionId), eq(combatants.discord_user_id, discordId)))
            .limit(1);

        if (!data?.id) {
            await interaction.followUp({ content: "❌ You haven't joined this combat setup.", ephemeral: true });
            return;
        }

        const combatantToDelete = data;
        log.debug({ combatantId: combatantToDelete.id }, 'Deleting combatant');

        await db.delete(combatants).where(eq(combatants.id, combatantToDelete.id));

        log.info({ combatantId: combatantToDelete.id }, 'Combatant deleted');
        await updateSetupMessage(interaction.client, sessionId);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleLeaveSetupInteraction');
        const errorMsg = error instanceof Error ? error.message : 'An error occurred trying to leave.';
        await interaction.followUp({ content: `❌ ${errorMsg}`, ephemeral: true }).catch(() => {});
    }
}

/**
 * Shows the modal for adding a mob.
 */
async function showAddMobModal(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Showing Add Mob Modal');

    try {
        const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId)).limit(1);

        if (!session) {
            await interaction.reply({ content: 'Not found', ephemeral: true });
            return;
        }
        if (session.dm_user_id !== interaction.user.id) {
            await interaction.reply({ content: 'DM only', ephemeral: true });
            return;
        }
        if (session.state !== 'SETUP') {
            await interaction.reply({ content: `State is ${session.state}`, ephemeral: true });
            return;
        }

        const modal = new ModalBuilder().setCustomId(`add_mob_submit_${sessionId}`).setTitle('Add Mob');
        const input = new TextInputBuilder()
            .setCustomId('mobNameInput')
            .setLabel('Mob Template Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));

        await interaction.showModal(modal);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error showing Add Mob modal');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Failed to show modal.', ephemeral: true }).catch(() => {});
        }
    }
}

/**
 * Handles the submission of the "Add Mob" modal.
 */
async function handleAddMobSubmitInteraction(interaction, sessionId) {
    log.info({ sessionId }, 'Handling Add Mob Submit');
    await interaction.deferUpdate({ ephemeral: true });

    const requestedMobName = interaction.fields.getTextInputValue('mobNameInput');

    try {
        let mobTemplate;
        try {
            log.debug({ mobName: requestedMobName }, 'Fetching mob template');
            const [data] = await db.select().from(mobs).where(eq(mobs.name, requestedMobName)).limit(1);

            if (!data?.id) throw new Error('Mob template not found or incomplete.');
            mobTemplate = data;
            log.debug({ mobId: mobTemplate.id }, 'Found mob template');
        } catch (fetchError) {
            log.warn({ mobName: requestedMobName }, 'Mob template not found');
            return interaction.followUp({
                content: `❌ Mob template named "**${requestedMobName}**" not found. Use \`/mob list\` or ensure exact spelling.`,
                ephemeral: true,
            });
        }

        const requiredFields = ['id', 'name', 'base_max_hp', 'base_initiative'];
        for (const field of requiredFields) {
            if (mobTemplate[field] === undefined || mobTemplate[field] === null) {
                log.error({ mobId: mobTemplate.id, missingField: field }, 'Mob template incomplete');
                return interaction.followUp({
                    content: `❌ Mob template "${requestedMobName}" is incomplete (missing ${field}).`,
                    ephemeral: true,
                });
            }
        }

        const combatantData = {
            sessionId: sessionId,
            type: 'NPC',
            allegiance: 'HOSTILE',
            mobDefinitionId: mobTemplate.id,
            playerId: null,
            discord_user_id: null,
            name: mobTemplate.name,
            maxHp: mobTemplate.base_max_hp,
            currentHp: mobTemplate.base_max_hp,
            initiativeBase: mobTemplate.base_initiative,
        };

        log.debug({ combatantData }, 'Calling create-combatant Edge Function');
        const { data, status, error } = await callEdgeFunction('create-combatant', combatantData);

        if (!error && (status === 200 || status === 201)) {
            log.info({ mobName: mobTemplate.name, sessionId }, 'NPC combatant added');
            await updateSetupMessage(interaction.client, sessionId);
        } else {
            log.error({ status, error: error?.message }, 'Failed to add NPC combatant');
            await interaction.followUp({
                content: `❌ Failed to add mob. ${error?.message || 'Unknown error'}.`,
                ephemeral: true,
            });
        }
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleAddMobSubmitInteraction');
        await interaction.followUp({ content: `❌ ${error.message}`, ephemeral: true }).catch(() => {});
    }
}

/**
 * Handles the "Manage Participants" button click.
 */
async function handleManageParticipantsInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Manage Participants');
    await interaction.deferReply({ ephemeral: true });

    try {
        const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId)).limit(1);

        if (!session?.id) {
            return interaction.editReply({ content: '❌ Could not fetch setup details.' });
        }

        const sessionCombatants = await db.select().from(combatants).where(eq(combatants.session_id, sessionId));
        session.combatants = sessionCombatants;

        if (session.dm_user_id !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Only the DM can manage participants.' });
        }
        if (session.state !== 'SETUP') {
            return interaction.editReply({ content: `❌ Can only manage during SETUP (Current: ${session.state}).` });
        }
        if (!session.combatants || session.combatants.length === 0) {
            return interaction.editReply({ content: 'ℹ️ There are no participants to manage yet.' });
        }

        const options = session.combatants.map(c => {
            const label = `${c.name || `ID ${c.id.substring(0, 6)}...`} (${c.type || '??'})`.substring(0, 100);
            return new StringSelectMenuOptionBuilder().setLabel(label).setValue(c.id);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`remove_participant_select_${sessionId}`)
            .setPlaceholder('Select a participant to remove...')
            .addOptions(options.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
            content: 'Select a participant below to remove them:',
            components: [row],
        });
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleManageParticipantsInteraction');
        await interaction.editReply({ content: '❌ An unexpected error occurred.' }).catch(() => {});
    }
}

/**
 * Handles the selection from the 'Remove Participant' select menu.
 */
async function handleRemoveParticipantSelectInteraction(interaction, sessionId) {
    const combatantIdToRemove = interaction.values[0];
    log.info({ sessionId, combatantId: combatantIdToRemove }, 'Handling Remove Participant Select');
    await interaction.deferUpdate({ ephemeral: true });

    try {
        const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId)).limit(1);

        if (!session || session.dm_user_id !== interaction.user.id) {
            return interaction.followUp({ content: `❌ You are no longer the DM for this session.`, ephemeral: true });
        }

        const dmUserId = session.dm_user_id;

        await db.delete(combatants).where(eq(combatants.id, combatantIdToRemove));

        log.info({ combatantId: combatantIdToRemove }, 'Combatant removed');
        await updateSetupMessage(interaction.client, sessionId);

        await interaction.editReply({ content: `✅ Participant removed successfully.`, components: [] });
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete ephemeral reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleRemoveParticipantSelectInteraction');
        await interaction.editReply({ content: '❌ An unexpected error occurred.', components: [] }).catch(() => {});
    }
}

/**
 * Handles the "Start Fight" button click.
 */
async function handleStartFightInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Start Fight');
    await interaction.deferReply({ ephemeral: true });
    const ctx = { discordId: interaction.user.id };

    const { sessionToMemory } = require('../utils/transforms');
    const { addLogEntry, updateCombatDisplay } = require('./combatTurnHandler');

    try {
        // service.beginCombat validates DM + SETUP state + counts/sides, rolls
        // initiative, transitions to RUNNING, sets turn order + first active,
        // and initializes current_round.
        let started;
        try {
            started = await beginCombat(ctx, sessionId);
        } catch (error) {
            return interaction.editReply({ content: `❌ ${error.data?.error || error.message}` });
        }

        const memorySession = sessionToMemory(started);
        memorySession.currentRound = started.current_round || 1;

        if (!interaction.client.activeCombats) {
            interaction.client.activeCombats = new Map();
        }
        interaction.client.activeCombats.set(started.channel_id, memorySession);

        const firstCombatantName = started.combatants.find(c => c.id === started.turn_order[0])?.name || 'Unknown';
        await addLogEntry(interaction.client, started.channel_id, sessionId, `--- Combat Started! ---`);
        await addLogEntry(interaction.client, started.channel_id, sessionId, `--- ${firstCombatantName}'s Turn ---`);

        await updateCombatDisplay(interaction.client, started.channel_id, memorySession);

        await interaction.editReply({ content: '✅ Combat started!' });
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete ephemeral reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleStartFightInteraction');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true }).catch(() => {});
        } else {
            await interaction.editReply({ content: '❌ An unexpected error occurred.' }).catch(() => {});
        }
    }
}

/**
 * Handles the "Cancel Combat" button click.
 */
async function handleCancelCombatInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Cancel Combat');
    await interaction.deferReply({ ephemeral: true });

    try {
        const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId)).limit(1);

        if (!session) throw new Error('Not found');
        if (session.dm_user_id !== interaction.user.id) throw new Error('Not DM');
        if (session.state !== 'SETUP') throw new Error(`Wrong state ${session.state}`);

        await db.delete(combatSessions).where(eq(combatSessions.id, sessionId));

        log.info({ sessionId }, 'Session deleted');

        if (session.message_id) {
            const channel = await interaction.client.channels.fetch(session.channel_id).catch(() => {});
            if (channel?.isTextBased()) {
                const msg = await channel.messages.fetch(session.message_id).catch(() => {});
                if (msg) {
                    await msg.edit({ content: `*Setup cancelled.*`, embeds: [], components: [] }).catch(() => {});
                }
            }
        }

        await interaction.editReply({ content: '✅ Combat setup cancelled.' });
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete ephemeral reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error in handleCancelCombatInteraction');
        const msg = error instanceof Error ? error.message : 'Error cancelling.';
        await interaction.editReply(`❌ ${msg}`);
    }
}

module.exports = {
    handleJoinCombatInteraction,
    handleLeaveSetupInteraction,
    showAddMobModal,
    handleAddMobSubmitInteraction,
    handleManageParticipantsInteraction,
    handleRemoveParticipantSelectInteraction,
    handleStartFightInteraction,
    handleCancelCombatInteraction,
    updateSetupMessage,
};
