const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editstats')
        .setDescription('Edit the stats of your selected character.'),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;

            // Fetch the selected player and their stats from the backend
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);
            const player = playerResponse.data;

            if (!player || !player.id) {
                return interaction.reply({ content: 'You have not selected a player yet. Use the /selectPlayer command to select a player.', ephemeral: true });
            }

            const stats = player.stats;

            if (!stats || !stats.id) {
                return interaction.reply({ content: 'Your selected player does not have any stats.', ephemeral: true });
            }

            // Create an embed to display current stats
            const statsEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`${player.name} - Edit Stats`)
                .setDescription('Select the stat you want to edit:')
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
                );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-stat')
                .setPlaceholder('Choose a stat to edit')
                .addOptions(
                    { label: 'MU', value: 'mu' },
                    { label: 'KL', value: 'kl' },
                    { label: 'IN', value: 'in' },
                    { label: 'CH', value: 'ch' },
                    { label: 'FF', value: 'ff' },
                    { label: 'GE', value: 'ge' },
                    { label: 'KO', value: 'ko' },
                    { label: 'KK', value: 'kk' },
                    { label: 'Maximale LP', value: 'le_max' },
                    { label: 'Aktuelle LP', value: 'le_current' },
                    { label: 'Initiative', value: 'initiative' },
                    { label: 'Ausweichen', value: 'ausweichen' }
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.reply({ embeds: [statsEmbed], components: [row], ephemeral: true });

            // Create the collector on the interaction response
            const collector = response.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

            collector.on('collect', async i => {
                const selectedStat = i.values[0];

                // Delete the initial message with the select menu
                await interaction.deleteReply();

                // Show a modal to input the new value for the selected stat
                const modal = new ModalBuilder()
                    .setCustomId('edit-stat-modal')
                    .setTitle(`Edit ${selectedStat.toUpperCase()}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('stat-value')
                                .setLabel(`New value for ${selectedStat.toUpperCase()}`)
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );

                await i.showModal(modal);

                try {
                    const submitted = await i.awaitModalSubmit({ time: 60000 });

                    if (submitted) {
                        const newValue = submitted.fields.getTextInputValue('stat-value');

                        // Validate that the new value is an integer
                        const intValue = parseInt(newValue, 10);
                        if (isNaN(intValue)) {
                            await submitted.reply({ content: 'The value you entered is not a valid integer. Please try again.', ephemeral: true });
                            return;
                        }

                        // Update the selected stat in the full stats object
                        stats[selectedStat] = intValue;

                        // Send the updated stats back to the server
                        await axios.put(`${process.env.BACKEND_URL}/stats/${stats.id}`, stats);

                        await submitted.reply({ content: `The stat ${selectedStat.toUpperCase()} has been updated to ${intValue}.`, ephemeral: true });

                        // Delete the confirmation message after 10 seconds
                        setTimeout(async () => {
                            await submitted.deleteReply();
                        }, 10000);
                    }
                } catch (err) {

                    if (!err.message.includes('Collector received no interactions before ending')) {
                        console.error('Modal submission failed:', err);
                        await i.followUp({ content: 'There was an error submitting the modal.', ephemeral: true });
                    }
                }
            });

            collector.on('end', async collected => {
                if (collected.size === 0) {
                    await interaction.followUp({ content: 'No stat was selected in time.', ephemeral: true });
                }
            });

        } catch (error) {
            console.error('Error editing stats:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: 'There was an error while trying to edit your stats.', ephemeral: true });
            }
        }
    }
};
