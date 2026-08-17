const { SlashCommandBuilder } = require('discord.js');
const { createCharacter } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const log = createLogger('create-character');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create-character')
        .setDescription('Create a new character with a specified name.')
        .addStringOption(option =>
            option.setName('name').setDescription('The name of your character.').setRequired(true)
        ),
    async execute(interaction) {
        const name = interaction.options.getString('name');

        try {
            await interaction.deferReply({ ephemeral: true });
            await createCharacter({ discordId: interaction.user.id }, { name });
            await interaction.editReply({ content: `Successfully created character ${name}` });
        } catch (error) {
            log.error({ error }, 'Error creating character');
            const errorMessage = error.data?.error || error.message || 'An unknown error occurred';
            await interaction.editReply({ content: `An error occurred while creating character: ${errorMessage}` });
        }
    },
};
