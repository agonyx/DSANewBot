const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listManeuvers } = require('../services/maneuvers');
const { createLogger } = require('../utils/logger');

const log = createLogger('list-maneuvers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-maneuvers')
        .setDescription('List the combat maneuver catalog')
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Filter by attack type')
                .addChoices(
                    { name: 'Melee', value: 'MELEE' },
                    { name: 'Ranged', value: 'RANGED' },
                    { name: 'Magic', value: 'MAGIC' }
                )
        ),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const maneuvers = await listManeuvers(
                { discordId: interaction.user.id },
                interaction.options.getString('type') || undefined
            );
            const lines = maneuvers.map(
                maneuver =>
                    `**${maneuver.name}** (${maneuver.action_type || 'passive'}) — ${maneuver.description || 'No description'}`
            );
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('⚔️ Combat Maneuvers')
                        .setDescription((lines.join('\n') || 'No maneuvers found.').substring(0, 4096)),
                ],
            });
        } catch (error) {
            log.error({ error }, 'Maneuver list failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
