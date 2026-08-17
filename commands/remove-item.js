const {
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { listItems, removeItem } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const log = createLogger('remove-item');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-item')
        .setDescription('Remove an item from your character inventory'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const itemsList = await listItems({ discordId: interaction.user.id });

            if (!itemsList || itemsList.length === 0) {
                return interaction.editReply({
                    content: 'Your character has no items to remove.',
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('remove_item_select')
                .setPlaceholder('Select an item to remove')
                .addOptions(
                    itemsList.map(item => ({
                        label: item.name,
                        description: `Type: ${item.type || 'N/A'} | Qty: ${item.quantity || 1}`,
                        value: item.id.toString(),
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const message = await interaction.editReply({
                content: `Select an item to remove from **${player.name}**:`,
                components: [row],
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000,
            });

            collector.on('collect', async i => {
                if (i.customId === 'remove_item_select') {
                    const itemId = i.values[0];
                    const item = itemsList.find(it => it.id.toString() === itemId);

                    const confirmButton = new ButtonBuilder()
                        .setCustomId(`remove_confirm_${itemId}`)
                        .setLabel('Remove')
                        .setStyle(ButtonStyle.Danger);

                    const cancelButton = new ButtonBuilder()
                        .setCustomId('remove_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary);

                    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                    await i.update({
                        content: `⚠️ Remove **${item.name}** (Qty: ${item.quantity || 1}) from inventory?`,
                        components: [row],
                    });
                } else if (i.customId === 'remove_cancel') {
                    await i.update({ content: '❌ Removal cancelled.', components: [] });
                    collector.stop();
                } else if (i.customId.startsWith('remove_confirm_')) {
                    const itemId = i.customId.replace('remove_confirm_', '');
                    const item = itemsList.find(it => it.id.toString() === itemId);

                    try {
                        await removeItem({ discordId: interaction.user.id }, parseInt(itemId));
                        await i.update({
                            content: `✅ **${item.name}** has been removed from **${player.name}**'s inventory.`,
                            components: [],
                        });
                    } catch (error) {
                        log.error({ error }, 'Remove item confirm error');
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
                            content: '⏰ Item selection timed out.',
                            components: [],
                        })
                        .catch(() => {});
                }
            });
        } catch (error) {
            if (error.status === 404) {
                return interaction.editReply({ content: 'No selected character! Use `/character select` first.' });
            }
            log.error({ error }, 'Remove item error');
            interaction.editReply({
                content: '❌ Failed to remove item.',
            });
        }
    },
};
