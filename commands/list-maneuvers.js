const { SlashCommandBuilder } = require('discord.js');
const { listManeuvers } = require('../services/maneuvers');
const { createLogger } = require('../utils/logger');
const { buildManeuverListEmbeds } = require('../utils/embedViews');

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
            return interaction.editReply({
                embeds: buildManeuverListEmbeds(maneuvers),
            });
        } catch (error) {
            log.error({ error }, 'Maneuver list failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
