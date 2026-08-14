const { SlashCommandBuilder } = require('discord.js');
const { listLearnedSpecialAbilities } = require('../services/advancement');
const { createLogger } = require('../utils/logger');
const { buildAbilityListEmbeds } = require('../utils/embedViews');

const log = createLogger('show-skills');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-skills')
        .setDescription('Displays the special abilities of your selected character.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await listLearnedSpecialAbilities({ discordId: interaction.user.id });
            return interaction.editReply({ embeds: buildAbilityListEmbeds(result) });
        } catch (error) {
            log.error({ error }, 'Error in /show-skills');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
