const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showhealth')
        .setDescription('Displays your current and maximum health.')
        .addBooleanOption(option => option.setName('visible').setDescription('Make the response visible to everyone in the channel.')),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;
            const visible = interaction.options.getBoolean('visible', false);

            // Fetch the selected player and their stats from the backend
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);
            const player = playerResponse.data;

            if (!player || !player.id) {
                return interaction.reply({ content: 'You are not registered in the system or do not have a selected player.', ephemeral: true });
            }

            // Access the health stats directly from the player object
            const { le_max, le_current } = player.stats;

            if (le_max === undefined || le_current === undefined) {
                return interaction.reply({ content: 'Your selected player does not have health stats.', ephemeral: true });
            }

            // Create an embed to display the health information
            const embed = new EmbedBuilder()
                .setColor(0x0099FF) // Set a color for the embed
                .setTitle(`${player.name}'s Health`)
                .setDescription(`Here are your current and maximum health values.`)
                .addFields(
                    { name: 'Current Health', value: `${le_current}`, inline: true },
                    { name: 'Maximum Health', value: `${le_max}`, inline: true }
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

                return interaction.reply({ embeds: [embed], files: [attachment], ephemeral: !visible });
            } else {
                return interaction.reply({ embeds: [embed], ephemeral: !visible });
            }

        } catch (error) {
            console.error('Error showing health:', error);
            return interaction.reply({ content: 'There was an error while retrieving your health information.', ephemeral: true });
        }
    }
};
