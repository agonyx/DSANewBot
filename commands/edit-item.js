const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { db } = require('../db');
const { eq, and } = require('drizzle-orm');
const { players, items } = require('../db/schema');
const { createLogger } = require('../utils/logger');
const { synchronizeEquipmentDerivedStatsInTransaction } = require('../services/equipment');
const { createEmbed, truncateText } = require('../utils/embedUtils');
const log = createLogger('edit-item');

const ITEM_STAT_CONFIG = [
    { key: 'name', backendKey: 'name', label: 'Name', type: 'string', style: TextInputStyle.Short },
    { key: 'type', backendKey: 'type', label: 'Type', type: 'item_type', style: TextInputStyle.Short },
    {
        key: 'quantity',
        backendKey: 'quantity',
        label: 'Quantity',
        type: 'integer',
        min: 1,
        style: TextInputStyle.Short,
    },
    { key: 'effect', backendKey: 'effect', label: 'Effect', type: 'string_long', style: TextInputStyle.Paragraph },
    {
        key: 'description',
        backendKey: 'description',
        label: 'Description',
        type: 'string_long',
        style: TextInputStyle.Paragraph,
    },
    {
        key: 'price',
        backendKey: 'price_kreuzer',
        label: 'Value (Kreuzer)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'weight',
        backendKey: 'weight_grams',
        label: 'Weight (grams)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'slot',
        backendKey: 'default_slot',
        label: 'Default Slot',
        type: 'equipment_slot',
        style: TextInputStyle.Short,
    },
    {
        key: 'armor_rs',
        backendKey: 'armor_rs',
        label: 'Armor RS',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'armor_be',
        backendKey: 'armor_be',
        label: 'Armor BE',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
];

const VALID_ITEM_TYPES = [
    'POTION',
    'FOOD',
    'SCROLL',
    'WEAPON',
    'ARMOR',
    'CLOTHING',
    'GEAR',
    'CONSUMABLE',
    'VALUABLE',
    'MISC',
];
const VALID_EQUIPMENT_SLOTS = ['HEAD', 'BODY', 'ARMS', 'HANDS', 'LEGS', 'FEET', 'BACK', 'WAIST', 'NECK', 'ACCESSORY'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-item')
        .setDescription('Interactively edit an item in your character inventory.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const [playerRow] = await db
                .select({ id: players.id, name: players.name })
                .from(players)
                .where(and(eq(players.discord_id, interaction.user.id), eq(players.selected, 'YES')))
                .limit(1);

            if (!playerRow) {
                return interaction.editReply({
                    content: 'No selected character! Use `/character select` first.',
                });
            }

            // Separate query for the items relation (Drizzle can't nest like PostgREST).
            const playerItems = await db.select().from(items).where(eq(items.player_id, playerRow.id));

            const player = { ...playerRow, items: playerItems };

            if (!player.items || player.items.length === 0) {
                return interaction.editReply({
                    content: 'Your character has no items to edit.',
                });
            }

            const itemSelect = new StringSelectMenuBuilder()
                .setCustomId('edititem_item_select')
                .setPlaceholder('Select an item to edit...')
                .addOptions(
                    player.items.map(item => ({
                        label: item.name,
                        description: `Type: ${item.type || 'N/A'} | Qty: ${item.quantity || 1}`,
                        value: item.id.toString(),
                    }))
                );

            const row = new ActionRowBuilder().addComponents(itemSelect);

            const message = await interaction.editReply({
                content: `Select an item to edit for **${player.name}**:`,
                components: [row],
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000,
            });

            let currentItem = null;

            const createStatSelect = itemData =>
                new StringSelectMenuBuilder()
                    .setCustomId('edititem_stat_select')
                    .setPlaceholder('Select property to edit...')
                    .addOptions(
                        ITEM_STAT_CONFIG.map(stat => ({
                            label: stat.label,
                            value: stat.key,
                            description: `Current: ${String(itemData[stat.backendKey] ?? 'N/A').substring(0, 95)}`,
                        }))
                    );

            const createItemEmbed = itemData =>
                createEmbed('inventory')
                    .setTitle(`Editing Item: ${itemData.name}`)
                    .addFields(
                        { name: 'Name', value: itemData.name || 'N/A', inline: true },
                        { name: 'Type', value: itemData.type || 'N/A', inline: true },
                        { name: 'Quantity', value: String(itemData.quantity ?? 1), inline: true },
                        { name: 'Weight', value: `${itemData.weight_grams ?? 0} g`, inline: true },
                        { name: 'Value', value: `${itemData.price_kreuzer ?? 0} K`, inline: true },
                        { name: 'Slot', value: itemData.default_slot || 'None', inline: true },
                        {
                            name: 'Armor',
                            value: `RS ${itemData.armor_rs ?? 0} / BE ${itemData.armor_be ?? 0}`,
                            inline: true,
                        },
                        { name: 'Effect', value: truncateText(itemData.effect, 1024, '*None*'), inline: false },
                        {
                            name: 'Description',
                            value: truncateText(itemData.description, 1024, '*None*'),
                            inline: false,
                        }
                    );

            const exitButton = new ButtonBuilder()
                .setCustomId('edititem_exit')
                .setLabel('Exit Editor')
                .setStyle(ButtonStyle.Danger);

            const modalHandler = async modalInteraction => {
                if (!modalInteraction.isModalSubmit()) return;
                if (!modalInteraction.customId.startsWith('edititem_modal_')) return;
                if (collector.ended) return;

                await modalInteraction.deferUpdate({ ephemeral: true });

                try {
                    const statKey = modalInteraction.customId.slice('edititem_modal_'.length);
                    const newValue = modalInteraction.fields.getTextInputValue('value');
                    const statConfig = ITEM_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig || !currentItem) return;

                    let validatedValue;
                    if (statConfig.type === 'integer') {
                        validatedValue = parseInt(newValue);
                        if (isNaN(validatedValue)) return;
                        if (statConfig.min !== undefined && validatedValue < statConfig.min) return;
                    } else if (statConfig.type === 'item_type') {
                        const upper = newValue.toUpperCase();
                        if (!VALID_ITEM_TYPES.includes(upper)) return;
                        validatedValue = upper;
                    } else if (statConfig.type === 'equipment_slot') {
                        if (newValue.trim() === '') {
                            validatedValue = null;
                        } else {
                            const upper = newValue.toUpperCase();
                            if (!VALID_EQUIPMENT_SLOTS.includes(upper)) return;
                            validatedValue = upper;
                        }
                    } else if (statConfig.type === 'string_long') {
                        validatedValue = newValue.trim() === '' ? null : newValue;
                    } else {
                        validatedValue = newValue.trim() || null;
                    }

                    if (currentItem[statConfig.backendKey] === validatedValue) return;

                    const refreshedData = await db.transaction(async tx => {
                        await tx
                            .update(items)
                            .set({ [statConfig.backendKey]: validatedValue })
                            .where(and(eq(items.id, currentItem.id), eq(items.player_id, player.id)));
                        await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
                        const [updated] = await tx.select().from(items).where(eq(items.id, currentItem.id)).limit(1);
                        return updated;
                    });

                    if (!refreshedData) return;
                    currentItem = refreshedData;

                    await interaction.editReply({
                        content: `Select an item to edit for **${player.name}**:`,
                        embeds: [createItemEmbed(currentItem)],
                        components: [
                            new ActionRowBuilder().addComponents(createStatSelect(currentItem)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });
                } catch (error) {
                    log.error({ error }, 'Modal handler error');
                }
            };

            interaction.client.on('interactionCreate', modalHandler);

            collector.on('collect', async i => {
                if (i.customId === 'edititem_item_select' && i.isStringSelectMenu()) {
                    const itemId = i.values[0];
                    currentItem = player.items.find(item => item.id.toString() === itemId);

                    if (!currentItem) {
                        await i.update({ content: 'Item not found.', components: [] });
                        collector.stop();
                        return;
                    }

                    await i.update({
                        content: `Select an item to edit for **${player.name}**:`,
                        embeds: [createItemEmbed(currentItem)],
                        components: [
                            new ActionRowBuilder().addComponents(createStatSelect(currentItem)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });
                } else if (i.customId === 'edititem_stat_select' && i.isStringSelectMenu()) {
                    const statKey = i.values[0];
                    const statConfig = ITEM_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig || !currentItem) return;

                    const currentValue = currentItem[statConfig.backendKey];

                    const modal = new ModalBuilder()
                        .setCustomId(`edititem_modal_${statKey}`)
                        .setTitle(`Edit ${statConfig.label}`);

                    const valueInput = new TextInputBuilder()
                        .setCustomId('value')
                        .setLabel(`Current: ${currentValue ?? 'N/A'}`)
                        .setStyle(statConfig.style)
                        .setValue(currentValue != null ? String(currentValue) : '')
                        .setRequired(false);

                    modal.addComponents(new ActionRowBuilder().addComponents(valueInput));
                    await i.showModal(modal);
                } else if (i.customId === 'edititem_exit' && i.isButton()) {
                    await interaction.deleteReply();
                    collector.stop('user_exit');
                }
            });

            collector.on('end', (collected, reason) => {
                interaction.client.removeListener('interactionCreate', modalHandler);
                if (reason !== 'user_exit') {
                    interaction.deleteReply().catch(() => {});
                }
            });
        } catch (error) {
            log.error({ error }, 'Edit item error');
            interaction.editReply({
                content: 'Failed to open item editor.',
            });
        }
    },
};
