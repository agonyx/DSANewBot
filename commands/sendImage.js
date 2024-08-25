const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendimage')
        .setDescription('Sends a test image to the channel.'),
    async execute(interaction) {
        try {
            // Replace this URL with any image URL you'd like to test
            const imageUrl = `${process.env.BACKEND_URL}/uploads/8-62923c97-44bc-42cb-8d24-23c30df3534b.png`;
            
            // Send the image directly
            return interaction.reply({ files: [imageUrl] });
        } catch (error) {
            console.error('Error sending image:', error);
            return interaction.reply({ content: 'There was an error while sending the image.', ephemeral: true });
        }
    }
};
