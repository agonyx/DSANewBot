const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { listItems } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { formatCurrency } = require('../utils/economyUtils');
const log = createLogger('show-items');

const TYPE_EMOJIS = {
    POTION: '🧪',
    FOOD: '🍖',
    SCROLL: '📜',
    WEAPON: '⚔️',
    ARMOR: '🛡️',
    CLOTHING: '👕',
    GEAR: '🎒',
    CONSUMABLE: '🧪',
    VALUABLE: '💎',
    MISC: '📦',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-items')
        .setDescription('Displays the items of your selected character.')
        .addBooleanOption(option =>
            option.setName('visible').setDescription('Make the response visible to everyone in the channel.')
        ),

    async execute(interaction) {
        const visible = interaction.options.getBoolean('visible', false);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const itemsList = await listItems({ discordId: interaction.user.id });

            if (!itemsList || itemsList.length === 0) {
                return interaction.reply({
                    content: 'Your selected player does not have any items.',
                    ephemeral: true,
                });
            }

            const itemsEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`🎒 ${player.name} - Inventory`)
                .setDescription(`**${itemsList.length} item${itemsList.length !== 1 ? 's' : ''} in inventory**`)
                .setFooter({
                    text: `Requested by ${interaction.user.username}`,
                    iconURL: interaction.user.avatarURL(),
                });

            // Group items by type
            const groupedItems = {};
            itemsList.forEach(item => {
                const type = item.type || 'MISC';
                if (!groupedItems[type]) groupedItems[type] = [];
                groupedItems[type].push(item);
            });

            Object.entries(groupedItems).forEach(([type, typeItems]) => {
                const emoji = TYPE_EMOJIS[type] || '📦';
                const value = typeItems
                    .map(item => {
                        let itemText = `**#${item.id} ${item.name}**`;
                        if (item.quantity && item.quantity > 1) {
                            itemText += ` x${item.quantity}`;
                        }
                        if (item.effect) {
                            itemText += `\n  └ *${item.effect}*`;
                        } else if (item.description) {
                            itemText += `\n  └ *${item.description.substring(0, 50)}${item.description.length > 50 ? '...' : ''}*`;
                        }
                        itemText += `\n  └ ${(item.weight_grams / 1000).toFixed(1)} Stein · ${formatCurrency(item.price_kreuzer)}`;
                        if (item.is_equipped) {
                            itemText += ` · Equipped: ${item.equipped_slot} · RS ${item.armor_rs} / BE ${item.armor_be}`;
                        }
                        return itemText;
                    })
                    .join('\n');

                itemsEmbed.addFields({
                    name: `${emoji} ${type}`,
                    value: value,
                    inline: false,
                });
            });

            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);
                    if (avatarBuffer) {
                        const attachment = new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' });
                        itemsEmbed.setThumbnail('attachment://avatar.png');
                        return interaction.reply({ embeds: [itemsEmbed], files: [attachment], ephemeral: !visible });
                    }
                } catch (e) {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.reply({ embeds: [itemsEmbed], ephemeral: !visible });
        } catch (error) {
            if (error.status === 404) {
                return interaction.reply({
                    content: 'You have not selected a character yet. Use `/character select` first.',
                    ephemeral: true,
                });
            }
            log.error({ error }, 'Error showing items');
            return interaction.reply({
                content: 'There was an error while fetching your items.',
                ephemeral: true,
            });
        }
    },
};
