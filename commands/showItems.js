const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showitems')
        .setDescription('Displays the items of your selected character.')
        .addBooleanOption(option => option.setName('visible').setDescription('Make the response visible to everyone in the channel.')),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;
            const visible = interaction.options.getBoolean('visible', false);

            // Fetch the selected player and their items from the backend
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);
            const player = playerResponse.data;

            if (!player || !player.id) {
                return interaction.reply({ content: 'You have not selected a player yet. Use the /selectPlayer command to select a player.', ephemeral: true });
            }

            const items = player.items;

            if (!items || items.length === 0) {
                return interaction.reply({ content: 'Your selected player does not have any items.', ephemeral: true });
            }

            const itemsEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`${player.name} - Items`)
                .setDescription('Here are the items your character currently has:')
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() });

            // Add each item as a field
            items.forEach(item => {
                itemsEmbed.addFields(
                    { name: item.name, value: `Type: ${item.type}\nDescription: ${item.description}`, inline: false }
                );
            });
            if (player.avatar) {
                const avatarUrl = `${process.env.BACKEND_URL}/uploads/${player.avatar}`;

                // Download the image and attach it
                const imageResponse = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'avatar.png' });

                // Set the attached image as the thumbnail
                itemsEmbed.setThumbnail('attachment://avatar.png');

                return interaction.reply({ embeds: [itemsEmbed], files: [attachment], ephemeral: !visible });
            } else {
                return interaction.reply({ embeds: [itemsEmbed], ephemeral: !visible });
            }

        } catch (error) {
            console.error('Error showing items:', error);
            return interaction.reply({ content: 'There was an error while fetching your items.', ephemeral: true });
        }
    }
};
