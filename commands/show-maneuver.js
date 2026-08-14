const { SlashCommandBuilder } = require('discord.js');
const { getManeuver, listManeuvers } = require('../services/maneuvers');
const { createLogger } = require('../utils/logger');
const { buildManeuverDetailEmbed } = require('../utils/embedViews');

const log = createLogger('show-maneuver');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-maneuver')
        .setDescription('Show one combat maneuver and its rules')
        .addStringOption(option =>
            option.setName('maneuver').setDescription('Maneuver').setRequired(true).setAutocomplete(true)
        ),
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const maneuvers = await listManeuvers({ discordId: interaction.user.id });
        return interaction.respond(
            maneuvers
                .filter(maneuver => maneuver.name.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(maneuver => ({ name: maneuver.name, value: maneuver.id }))
        );
    },
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const maneuver = await getManeuver(
                { discordId: interaction.user.id },
                interaction.options.getString('maneuver')
            );
            return interaction.editReply({
                embeds: [buildManeuverDetailEmbed(maneuver)],
            });
        } catch (error) {
            log.error({ error }, 'Show maneuver failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
