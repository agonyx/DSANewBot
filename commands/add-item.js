const { SlashCommandBuilder } = require('discord.js');
const { addItem } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const log = createLogger('add-item');

const ITEM_TYPES = [
    { name: '🧪 Potion', value: 'POTION' },
    { name: '🍖 Food/Drink', value: 'FOOD' },
    { name: '📜 Scroll', value: 'SCROLL' },
    { name: '⚔️ Weapon', value: 'WEAPON' },
    { name: '🛡️ Armor', value: 'ARMOR' },
    { name: '👕 Clothing', value: 'CLOTHING' },
    { name: '🎒 Gear', value: 'GEAR' },
    { name: '🧪 Consumable', value: 'CONSUMABLE' },
    { name: '💎 Valuable', value: 'VALUABLE' },
    { name: '📦 Misc', value: 'MISC' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-item')
        .setDescription('Add an item to your character inventory')
        .addStringOption(option => option.setName('name').setDescription('Item name').setRequired(true))
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Item type')
                .setRequired(false)
                .addChoices(...ITEM_TYPES)
        )
        .addStringOption(option =>
            option
                .setName('effect')
                .setDescription('Effect when used (e.g., "Heal 1w6+2 LeP", "Restore 5 AsP")')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('description').setDescription('Item description/flavor text').setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('quantity').setDescription('Quantity (default: 1)').setRequired(false).setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('price_kreuzer').setDescription('Unit value in Kreuzer').setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('weight_grams').setDescription('Unit weight in grams').setMinValue(0)
        )
        .addStringOption(option =>
            option
                .setName('slot')
                .setDescription('Default equipment slot')
                .addChoices(
                    ...['HEAD', 'BODY', 'ARMS', 'HANDS', 'LEGS', 'FEET', 'BACK', 'WAIST', 'NECK', 'ACCESSORY'].map(
                        slot => ({ name: slot, value: slot })
                    )
                )
        )
        .addIntegerOption(option =>
            option.setName('armor_rs').setDescription('Armor protection while equipped').setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('armor_be').setDescription('Armor Belastung while equipped').setMinValue(0).setMaxValue(4)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });

            const name = interaction.options.getString('name');
            const type = interaction.options.getString('type') || 'MISC';
            const effect = interaction.options.getString('effect');
            const description = interaction.options.getString('description');
            const quantity = interaction.options.getInteger('quantity') || 1;

            // addItem stacks onto an existing same-name+type item, else creates one.
            const item = await addItem(
                { discordId: interaction.user.id },
                {
                    name,
                    type,
                    effect,
                    description,
                    quantity,
                    priceKreuzer: interaction.options.getInteger('price_kreuzer') || 0,
                    weightGrams: interaction.options.getInteger('weight_grams') || 0,
                    defaultSlot: interaction.options.getString('slot'),
                    armorRs: interaction.options.getInteger('armor_rs') || 0,
                    armorBe: interaction.options.getInteger('armor_be') || 0,
                }
            );

            const stacked = item.quantity > quantity;

            const embed = createEmbed('success')
                .setTitle(stacked ? '📦 Items Stacked' : '📦 Item Added')
                .setDescription(
                    stacked
                        ? `Added **${quantity}** to existing **${name}** in **${player.name}**'s inventory`
                        : `Added item to **${player.name}**'s inventory`
                )
                .addFields(
                    { name: 'Name', value: item.name, inline: true },
                    { name: 'Type', value: item.type, inline: true },
                    {
                        name: stacked ? 'New Quantity' : 'Quantity',
                        value: item.quantity.toString(),
                        inline: true,
                    }
                );
            embed.addFields(
                { name: 'Weight', value: `${item.weight_grams} g`, inline: true },
                { name: 'Value', value: `${item.price_kreuzer} K`, inline: true },
                {
                    name: 'Equipment',
                    value: item.default_slot ? `${item.default_slot} · RS ${item.armor_rs} · BE ${item.armor_be}` : '—',
                    inline: true,
                }
            );

            if (item.effect) {
                embed.addFields({ name: 'Effect', value: item.effect, inline: false });
            }
            if (item.description) {
                embed.addFields({ name: 'Description', value: item.description, inline: false });
            }

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Add item error');
            const message = error.data?.error || error.message || 'Failed to add item.';
            return interaction.editReply({ content: `❌ ${message}` });
        }
    },
};
