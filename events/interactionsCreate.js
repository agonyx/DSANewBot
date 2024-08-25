const { InteractionType, ComponentType } = require('discord.js');
const axios = require('axios');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (interaction.type === InteractionType.MessageComponent && interaction.componentType === ComponentType.StringSelect) {
            if (interaction.customId === 'select-character') {
                const selectedPlayerId = interaction.values[0]; // Get the selected player ID
                const discordId = interaction.user.id;

                try {
                    // Fetch the selected player's details to get the name
                    const response = await axios.get(`${process.env.BACKEND_URL}/player/${selectedPlayerId}`);
                    const playerName = response.data.name;

                    // Update the selected player in the backend
                    await axios.put(`${process.env.BACKEND_URL}/player/selected/${discordId}/${selectedPlayerId}`);

                    await interaction.update({ content: `You have selected the character: ${playerName}.`, components: [] });
                } catch (error) {
                    console.error('Error selecting character:', error);
                    await interaction.update({ content: 'An error occurred while selecting your character. Please try again later.', components: [] });
                }
            }
        }
    },
};
