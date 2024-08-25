const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showstats')
        .setDescription('Displays the stats of the player that runs the command.')
        .addBooleanOption(option => option.setName('visible').setDescription('Make the response visible to everyone in the channel.')),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;
            const visible = interaction.options.getBoolean('visible', false);

            // Fetch the selected player and their stats in one request
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);

            if (!playerResponse.data || !playerResponse.data.id) {
                return interaction.reply({ content: 'You have not selected a player yet. Use the /selectPlayer command to select a player.', ephemeral: true });
            }

            const player = playerResponse.data;
            const stats = player.stats;

            if (!stats) {
                return interaction.reply({ content: 'Your selected player does not have any stats.', ephemeral: true });
            }

            // Create a rich embed message
            const statsEmbed = new EmbedBuilder()
                .setColor(0x0099FF) // Choose a color for the embed
                .setTitle(`${player.name}`)
                .setDescription(`Here are the stats for your selected character.`)
                .addFields(
                    { name: 'MU', value: `${stats.mu}`, inline: true },
                    { name: 'KL', value: `${stats.kl}`, inline: true },
                    { name: 'IN', value: `${stats.in}`, inline: true },
                    { name: 'CH', value: `${stats.ch}`, inline: true },
                    { name: 'FF', value: `${stats.ff}`, inline: true },
                    { name: 'GE', value: `${stats.ge}`, inline: true },
                    { name: 'KO', value: `${stats.ko}`, inline: true },
                    { name: 'KK', value: `${stats.kk}`, inline: true },
                    { name: 'Maximale LP', value: `${stats.le_max}`, inline: true },
                    { name: 'Aktuelle LP', value: `${stats.le_current}`, inline: true },
                    { name: 'Initiative', value: `${stats.initiative}`, inline: true },
                    { name: 'Ausweichen', value: `${stats.ausweichen}`, inline: true }
                )
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() });

            // If the player has an avatar, set it as the embed's thumbnail or image
            if (player.avatar) {
                // Assuming avatar is stored as a URL in the database
                const avatarUrl = `${process.env.BACKEND_URL}/uploads/${player.avatar}`;
                console.log('Avatar URL:', avatarUrl);
                statsEmbed.setThumbnail(avatarUrl);
            }

            return interaction.reply({ embeds: [statsEmbed], ephemeral: !visible });
        } catch (error) {
            console.error('Error getting stats:', error);
            if (error.response && error.response.status === 404) {
                return interaction.reply({ content: 'You have not selected a player yet. Use the /selectPlayer command to select a player.', ephemeral: true });
            } else {
                return interaction.reply({ content: 'There was an error while getting your stats.', ephemeral: true });
            }
        }
    }
};
