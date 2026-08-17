const { ButtonBuilder } = require('@discordjs/builders');
const { ActionRowBuilder } = require('@discordjs/builders');
const { ButtonStyle } = require('discord.js');
const { createEmbed } = require('./embedUtils');

// --- Helper function to build the Setup Embed ---
function createSetupEmbed(sessionId, dmUsername, participants = [], canStart = false) {
    const players = participants.filter(p => p.type === 'PLAYER');
    const hostiles = participants.filter(p => p.type === 'NPC'); // Assuming all NPCs are hostile for now

    const truncate = name => (name.length > 24 ? `${name.substring(0, 21)}...` : name);

    const formatParticipantList = list => {
        if (list.length === 0) return 'None';
        const displayList = list.slice(0, 8).map(p => `• ${truncate(p.name || 'Unknown')}`);
        if (list.length > 8) {
            displayList.push(`*+${list.length - 8} more...*`);
        }
        return displayList.join('\n');
    };

    const playerList = formatParticipantList(players);
    const hostileList = formatParticipantList(hostiles);

    const readinessDescription = canStart ? '✅ Ready to start!' : '⏳ Waiting for more participants...';

    const nextActions = canStart
        ? 'DM: Press "Start Fight" to begin combat.'
        : 'Players: Use "Join Combat" to enter the lobby.\nDM: Use "Add Mob" to add hostiles.';

    const embed = createEmbed(canStart ? 'success' : 'warning')
        .setTitle('Combat Lobby')
        .setDescription(`*Organized by ${dmUsername}*\n${readinessDescription}`)
        .addFields(
            {
                name: 'Status',
                value: `**${participants.length}** participants. Need at least 1 player and 1 hostile, minimum 2 total.`,
                inline: false,
            },
            {
                name: `Players (${players.length})`,
                value: playerList,
                inline: true,
            },
            {
                name: `Hostiles (${hostiles.length})`,
                value: hostileList,
                inline: true,
            },
            {
                name: 'Next Actions',
                value: nextActions,
                inline: false,
            }
        )
        .setFooter({ text: `Session ID: ${sessionId.substring(0, 8)}` });

    return embed;
}

/**
 * Creates the Action Rows with buttons for the combat setup message.
 * @param {string} sessionId - The ID of the combat session.
 * @param {boolean} canStart - Whether the start button should be enabled.
 * @returns {ActionRowBuilder[]} An array of ActionRowBuilder instances.
 */
/**
 * Creates the Action Rows with buttons for the combat setup message.
 * Corrected to use emoji objects.
 * @param {string} sessionId - The ID of the combat session.
 * @param {boolean} canStart - Whether the start button should be enabled.
 * @returns {ActionRowBuilder[]} An array of ActionRowBuilder instances.
 */
function createSetupActionRows(sessionId, canStart) {
    const joinButton = new ButtonBuilder()
        .setCustomId(`join_combat_${sessionId}`)
        .setLabel('Join Combat')
        .setStyle(ButtonStyle.Success)
        // *** FIX: Use emoji object ***
        .setEmoji({ name: '➕' });

    const manageButton = new ButtonBuilder()
        .setCustomId(`manage_participants_${sessionId}`)
        .setLabel('Manage Participants')
        .setStyle(ButtonStyle.Primary)
        // *** FIX: Use emoji object ***
        .setEmoji({ name: '⚙️' });

    const startButton = new ButtonBuilder()
        .setCustomId(`start_fight_${sessionId}`)
        .setLabel('Start Fight')
        .setStyle(ButtonStyle.Primary)
        // *** FIX: Use emoji object ***
        .setEmoji({ name: '▶️' })
        .setDisabled(!canStart);

    const leaveButton = new ButtonBuilder()
        .setCustomId(`leave_setup_${sessionId}`)
        .setLabel('Leave Setup')
        .setStyle(ButtonStyle.Secondary)
        // *** FIX: Use emoji object ***
        .setEmoji({ name: '🚪' });

    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_combat_${sessionId}`)
        .setLabel('Cancel Setup')
        .setStyle(ButtonStyle.Danger)
        // *** FIX: Use emoji object ***
        .setEmoji({ name: '✖️' });
    const addMobButton = new ButtonBuilder()
        .setCustomId(`add_mob_modal_${sessionId}`) // Button to trigger showing the modal
        .setLabel('Add Mob')
        .setStyle(ButtonStyle.Secondary) // Keep secondary style
        .setEmoji({ name: '👾' });
    // Arrange buttons in rows
    const row1 = new ActionRowBuilder().addComponents(joinButton, addMobButton, startButton);
    const row2 = new ActionRowBuilder().addComponents(leaveButton, manageButton, cancelButton);

    return [row1, row2];
}

// --- Export the functions ---
module.exports = {
    createSetupEmbed,
    createSetupActionRows,
};
