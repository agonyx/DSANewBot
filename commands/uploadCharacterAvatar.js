const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uploadcharacteravatar')
        .setDescription('Upload an image for your character.')
        .addAttachmentOption(option => 
            option.setName('image')
                .setDescription('The image file for your character.')
                .setRequired(true)),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;

            // Fetch the selected player by discordId to get the player ID
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);

            if (!playerResponse.data || !playerResponse.data.id) {
                return interaction.reply({ content: 'No player selected. Use the /selectPlayer command first.', ephemeral: true });
            }

            const playerId = playerResponse.data.id;

            // Get the image attachment from the command
            const attachment = interaction.options.getAttachment('image');
            if (!attachment) {
                return interaction.reply({ content: 'No image uploaded.', ephemeral: true });
            }

            // Download the image from the attachment URL
            const imageResponse = await axios.get(attachment.url, { responseType: 'stream' });

            // Prepare form data to send the image as multipart/form-data
            const form = new FormData();
            form.append('avatar', imageResponse.data, {
                filename: attachment.name,
                contentType: attachment.contentType,
            });

            // Send the image to your backend, updating the player's avatar
            await axios.put(`${process.env.BACKEND_URL}/player/${playerId}/avatar`, form, {
                headers: {
                    ...form.getHeaders(),
                },
            });

            // Respond to the user
            return interaction.reply({ content: 'Your character avatar has been updated successfully!', ephemeral: true });
        } catch (error) {
            console.error('Error uploading image:', error);
            return interaction.reply({ content: 'There was an error uploading your image.', ephemeral: true });
        }
    }
};
