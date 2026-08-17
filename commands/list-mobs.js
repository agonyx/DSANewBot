const { SlashCommandBuilder } = require('discord.js');
const { listMobs } = require('../services/mobs');
const { createLogger } = require('../utils/logger');
const { buildMobListEmbeds } = require('../utils/embedViews');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const log = createLogger('list-mobs');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder()
            .setName('list-mobs')
            .setDescription('Lists available mob templates defined for combat.')
            .setDMPermission(false)
    ),

    async execute(interaction) {
        await deferWithVisibility(interaction);

        try {
            const mobRows = await listMobs({ discordId: interaction.user.id });

            if (!mobRows || mobRows.length === 0) {
                await interaction.editReply(
                    'ℹ️ No mob templates have been defined yet. Use `/mob add` to create some.'
                );
                return;
            }

            await interaction.editReply({ embeds: buildMobListEmbeds(mobRows) });
        } catch (error) {
            log.error({ error }, 'Error executing /list-mobs');
            await interaction.editReply({ content: `❌ Error: ${error.message || 'Failed to fetch mob list.'}` });
        }
    },
};
