const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { exportCharacterSheet } = require('../services/characterExports');
const { createLogger } = require('../utils/logger');

const log = createLogger('export-character');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export-character')
        .setDescription('Export your selected character sheet as a UTF-8 text file')
        .addBooleanOption(option => option.setName('visible').setDescription('Make the export visible to everyone')),

    async execute(interaction) {
        const visible = interaction.options.getBoolean('visible') || false;
        await interaction.deferReply({ ephemeral: !visible });
        try {
            const result = await exportCharacterSheet({ discordId: interaction.user.id });
            const attachment = new AttachmentBuilder(Buffer.from(result.text, 'utf8'), { name: result.filename });
            return interaction.editReply({
                content: `📄 Character sheet exported for **${result.characterName}**.`,
                files: [attachment],
            });
        } catch (error) {
            log.error({ error }, 'Character export failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
