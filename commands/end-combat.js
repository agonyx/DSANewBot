const { SlashCommandBuilder } = require('discord.js');
const { db, callEdgeFunction } = require('../db');
const { eq, and, inArray } = require('drizzle-orm');
const { combatSessions, combatants } = require('../db/schema');
const { updateCombatDisplay } = require('../handlers/combatHandler');
const { createLogger } = require('../utils/logger');
const log = createLogger('end-combat');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end-combat')
        .setDescription('Prematurely ends the current combat session (DM only).')
        .addStringOption(option =>
            option.setName('reason').setDescription('An optional reason for ending the combat.').setRequired(false)
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const channelId = interaction.channelId;
        const dmUserId = interaction.user.id;
        const reason = interaction.options.getString('reason') || 'Ended by the DM.';

        try {
            let sessionData;

            if (interaction.client.activeCombats?.has(channelId)) {
                sessionData = interaction.client.activeCombats.get(channelId);
            } else {
                const [data] = await db
                    .select()
                    .from(combatSessions)
                    .where(
                        and(
                            eq(combatSessions.channel_id, channelId),
                            inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED'])
                        )
                    )
                    .limit(1);

                if (!data) {
                    return interaction.editReply('❌ There is no active combat session in this channel to end.');
                }

                const combatantsRows = await db
                    .select()
                    .from(combatants)
                    .where(eq(combatants.session_id, data.id));

                sessionData = {
                    ...data,
                    dmUserId: data.dm_user_id,
                    channelId: data.channel_id,
                    messageId: data.message_id,
                    combatLog: data.combat_log,
                    turnOrder: data.turn_order,
                    currentTurnIndex: data.current_turn_index,
                    currentRound: data.current_round,
                    combatants: combatantsRows.map(c => ({
                        ...c,
                        maxHP: c.max_hp,
                        currentHP: c.current_hp,
                        initiativeRoll: c.initiative_roll,
                        initiativeBase: c.initiative_base,
                        playerId: c.player_id,
                        discordUserId: c.discord_user_id,
                        mobDefinitionId: c.mob_definition_id,
                        sessionId: c.session_id,
                        isActiveTurn: c.is_active_turn,
                    })),
                };
                sessionData.currentRound = sessionData.currentRound || 1;

                if (!interaction.client.activeCombats) interaction.client.activeCombats = new Map();
                interaction.client.activeCombats.set(channelId, sessionData);
            }

            if (!sessionData) {
                return interaction.editReply('❌ Could not find an active combat session in this channel.');
            }

            const sessionId = sessionData.id;

            if (sessionData.dm_user_id !== dmUserId) {
                return interaction.editReply('❌ Only the DM who started the combat can end it.');
            }

            await callEdgeFunction('end-combat', {
                sessionId,
                reason,
            });

            sessionData.state = 'ENDED';
            if (!sessionData.combat_log) sessionData.combat_log = [];
            sessionData.combat_log.push(`--- Combat Ended: ${reason} ---`);

            await updateCombatDisplay(interaction.client, channelId);

            interaction.client.activeCombats.delete(channelId);

            await interaction.editReply('✅ Combat has been ended.');
        } catch (error) {
            log.error({ error }, 'Error ending combat');
            await interaction.editReply(`❌ An error occurred: ${error.message || 'Failed to end combat.'}`);
        }
    },
};
