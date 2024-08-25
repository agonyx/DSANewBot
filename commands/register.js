const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Registers a new player with a specified name.')
        .addStringOption(option => option.setName('name').setDescription('The name of your character.').setRequired(true)),
    async execute(interaction) {
        const name = interaction.options.getString('name');
        const discordId = interaction.user.id;

        try {
            // Defer the reply to give more time for the backend request
            await interaction.deferReply({ ephemeral: true });

            // Send a POST request to your backend
            const response = await axios.post('http://localhost:3000/player', {
                name: name,
                discordId: discordId,
            });

            // Check the response from the backend
            if (response.status === 201) {
                await interaction.editReply({ content: `Successfully registered new player ${name}` });
            } else {
                console.error('Failed to register player:', response.data);
                await interaction.editReply({ content: 'Failed to register new player. Please try again later.' });
            }
        } catch (error) {
            console.error('Error registering player:', error);
            await interaction.editReply({ content: 'An error occurred while registering the player. Please try again later.' });
        }
    },
};
