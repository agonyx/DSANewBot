const { SlashCommandBuilder } = require('discord.js');
const { getManeuver, listManeuvers } = require('../services/maneuvers');
const { createLogger } = require('../utils/logger');
const {
    buildManeuverComponentPayload,
    buildNoticeComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
const { addVisibilityOption, interactionVisibility } = require('../utils/interactionVisibility');

const log = createLogger('show-maneuver');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder()
            .setName('show-maneuver')
            .setDescription('Show one combat maneuver and its rules')
            .addStringOption(option =>
                option.setName('maneuver').setDescription('Maneuver').setRequired(true).setAutocomplete(true)
            )
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
        const visibility = interactionVisibility(interaction);
        await deferForComponents(interaction, visibility);
        try {
            const maneuver = await getManeuver(
                { discordId: interaction.user.id },
                interaction.options.getString('maneuver')
            );
            return editDeferredComponents(
                interaction,
                buildManeuverComponentPayload(maneuver, { ephemeral: visibility.ephemeral })
            );
        } catch (error) {
            log.error({ error }, 'Show maneuver failed');
            return editDeferredComponents(
                interaction,
                buildNoticeComponentPayload(`❌ ${error.data?.error || error.message}`, { theme: 'error' })
            );
        }
    },
};
