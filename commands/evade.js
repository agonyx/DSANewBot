const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const { rollDice } = require('../utils/rollUtil'); // Import the rollDice function
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evade')
        .setDescription('Attempts to evade an attack using the Ausweichen stat.'),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;

            // Fetch the selected player and their stats from the backend
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);
            const player = playerResponse.data;

            if (!player || !player.id) {
                return interaction.reply({ content: 'You are not registered in the system or do not have a selected player.', ephemeral: true });
            }

            // Access the stats directly from the player object
            const { ausweichen } = player.stats;

            if (!ausweichen) {
                return interaction.reply({ content: 'Your selected player does not have an Ausweichen stat.', ephemeral: true });
            }

            const diceRoll = rollDice(20); // Use the rollDice function from rollUtil.js
            const success = diceRoll <= ausweichen;

            // Create an embed to display the result
            const embed = new EmbedBuilder()
                .setColor(success ? 0x00FF00 : 0xFF0000) // Green for success, red for failure
                .setTitle(`${player.name}'s Evade Attempt`)
                .setDescription(success ? 
                    `You rolled a ${diceRoll} and **successfully** evaded the attack!` :
                    `You rolled a ${diceRoll} and **failed** to evade the attack.`
                )
                .addFields(
                    { name: 'Ausweichen Stat', value: `${ausweichen}`, inline: true },
                    { name: 'Dice Roll', value: `${diceRoll}`, inline: true }
                )
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() });

            // If the player has an avatar, set it as the embed's thumbnail
            if (player.avatar) {
                const avatarUrl = `${process.env.BACKEND_URL}/uploads/${player.avatar}`;

                // Download the image and attach it
                const imageResponse = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'avatar.png' });

                // Set the attached image as the thumbnail
                embed.setThumbnail('attachment://avatar.png');

                return interaction.reply({ embeds: [embed], files: [attachment]});
            } else {
                return interaction.reply({ embeds: [embed]});
            }

        } catch (error) {
            console.error('Error attempting to evade:', error);
            return interaction.reply({ content: 'There was an error while attempting to evade.', ephemeral: true });
        }
    }
};
