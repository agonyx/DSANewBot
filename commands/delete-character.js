const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listCharacters, deleteCharacter } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const log = createLogger('delete-character');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete-character')
        .setDescription('Delete one of your characters permanently'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const discordId = interaction.user.id;

        try {
            const playerRows = await listCharacters({ discordId });

            if (!playerRows || playerRows.length === 0) {
                return interaction.editReply('❌ You do not have any characters to delete.');
            }

            if (playerRows.length === 1) {
                const player = playerRows[0];

                const confirmButton = new ButtonBuilder()
                    .setCustomId(`delete_confirm_${player.id}`)
                    .setLabel('Delete')
                    .setStyle(ButtonStyle.Danger);

                const cancelButton = new ButtonBuilder()
                    .setCustomId('delete_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary);

                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                const message = await interaction.editReply({
                    content: `⚠️ **Warning!** This will permanently delete **${player.name}**. This action cannot be undone!`,
                    components: [row],
                });

                const collector = message.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id,
                    time: 30000,
                });

                collector.on('collect', async i => {
                    if (i.customId === 'delete_cancel') {
                        await i.update({ content: '❌ Deletion cancelled.', components: [] });
                        collector.stop();
                    } else if (i.customId.startsWith('delete_confirm_')) {
                        const playerId = Number(i.customId.replace('delete_confirm_', ''));

                        try {
                            await deleteCharacter({ discordId }, playerId);
                            await i.update({
                                content: `✅ Character **${player.name}** has been permanently deleted.`,
                                components: [],
                            });
                        } catch (error) {
                            log.error({ error }, 'Delete character confirm error');
                            await i.update({
                                content: `❌ ${error.data?.error || error.message}`,
                                components: [],
                            });
                        }
                        collector.stop();
                    }
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time') {
                        interaction
                            .editReply({
                                content: '⏰ Deletion confirmation timed out.',
                                components: [],
                            })
                            .catch(() => {});
                    }
                });
            } else {
                const { StringSelectMenuBuilder } = require('discord.js');

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('delete_character_select')
                    .setPlaceholder('Select a character to delete')
                    .addOptions(
                        playerRows.map(p => ({
                            label: p.name + (p.selected === 'YES' ? ' (Selected)' : ''),
                            value: p.id,
                        }))
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                const message = await interaction.editReply({
                    content: 'Select the character you want to delete:',
                    components: [row],
                });

                const collector = message.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id,
                    time: 60000,
                });

                collector.on('collect', async i => {
                    if (i.customId === 'delete_character_select') {
                        const playerId = i.values[0];
                        const player = playerRows.find(p => p.id === playerId);

                        const confirmButton = new ButtonBuilder()
                            .setCustomId(`delete_confirm_${playerId}`)
                            .setLabel('Delete')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('delete_cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                        await i.update({
                            content: `⚠️ **Warning!** This will permanently delete **${player.name}**. This action cannot be undone!`,
                            components: [row],
                        });
                    } else if (i.customId === 'delete_cancel') {
                        await i.update({ content: '❌ Deletion cancelled.', components: [] });
                        collector.stop();
                    } else if (i.customId.startsWith('delete_confirm_')) {
                        const playerId = Number(i.customId.replace('delete_confirm_', ''));
                        const player = playerRows.find(p => p.id === playerId);

                        try {
                            await deleteCharacter({ discordId }, playerId);
                            await i.update({
                                content: `✅ Character **${player.name}** has been permanently deleted.`,
                                components: [],
                            });
                        } catch (error) {
                            log.error({ error }, 'Delete character confirm error');
                            await i.update({
                                content: `❌ ${error.data?.error || error.message}`,
                                components: [],
                            });
                        }
                        collector.stop();
                    }
                });

                collector.on('end', (collected, reason) => {
                    if (reason === 'time') {
                        interaction
                            .editReply({
                                content: '⏰ Character selection timed out.',
                                components: [],
                            })
                            .catch(() => {});
                    }
                });
            }
        } catch (error) {
            log.error({ error }, 'Delete character error');
            return interaction.editReply({
                content: `❌ An error occurred: ${error.message}`,
            });
        }
    },
};
