const { SlashCommandBuilder } = require('discord.js');
const { listCharacterRecords } = require('../services/characterRecords');
const { buildCharacterRecordListEmbeds } = require('../utils/campaignViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('reputation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reputation')
        .setDescription('Show faction standings for the selected character')
        .addBooleanOption(option => option.setName('visible').setDescription('Make standings visible to everyone')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: !(interaction.options.getBoolean('visible') || false) });
        try {
            const records = await listCharacterRecords({ discordId: interaction.user.id }, 'REPUTATION');
            return interaction.editReply({
                embeds: buildCharacterRecordListEmbeds('⚖️ Faction Standing', records, interaction.user),
            });
        } catch (error) {
            log.error({ error }, 'Reputation command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to load reputation.'}`);
        }
    },
};
