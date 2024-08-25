const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('choosecharacter')
        .setDescription('Choose a character from your available characters.'),
    async execute(interaction) {
        const discordId = interaction.user.id;

        try {
            // Fetch the user's characters from the backend
            const response = await axios.get(`${process.env.BACKEND_URL}/player/discord/${discordId}`);

            const players = response.data;

            if (players.length === 0) {
                return interaction.reply({ content: 'You do not have any characters to choose from.', ephemeral: true });
            }

            // Create the select menu options based on the user's characters
            const options = players.map(player => ({
                label: player.name,
                value: player.id.toString(), // Assuming the player's ID is a number
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-character')
                .setPlaceholder('Choose your character')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            // Send the select menu to the user
            await interaction.reply({ content: 'Please choose your character:', components: [row], ephemeral: true });
        } catch (error) {
            console.error('Error fetching characters:', error);
            return interaction.reply({ content: 'An error occurred while fetching your characters. Please try again later.', ephemeral: true });
        }
    },
};
