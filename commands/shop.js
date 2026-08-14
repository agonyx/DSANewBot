const { SlashCommandBuilder } = require('discord.js');
const { buyCatalogItem, listCatalog, sellOwnedAsset } = require('../services/economy');
const { formatCurrency } = require('../utils/economyUtils');
const { createLogger } = require('../utils/logger');
const { buildSectionEmbeds } = require('../utils/embedUtils');
const log = createLogger('shop');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse, buy, or sell equipment')
        .addSubcommand(command =>
            command
                .setName('browse')
                .setDescription('Browse the equipment catalog')
                .addStringOption(option => option.setName('search').setDescription('Name search'))
                .addStringOption(option =>
                    option
                        .setName('category')
                        .setDescription('Catalog category')
                        .addChoices(
                            { name: 'Weapons', value: 'WEAPON' },
                            { name: 'Shields', value: 'SHIELD' },
                            { name: 'Armor', value: 'ARMOR' },
                            { name: 'Clothing', value: 'CLOTHING' },
                            { name: 'Gear', value: 'GEAR' },
                            { name: 'Consumables', value: 'CONSUMABLE' }
                        )
                )
        )
        .addSubcommand(command =>
            command
                .setName('buy')
                .setDescription('Buy a catalog entry')
                .addStringOption(option =>
                    option.setName('catalog').setDescription('Catalog item').setRequired(true).setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('quantity').setDescription('Quantity').setMinValue(1).setMaxValue(100)
                )
        )
        .addSubcommand(command =>
            command
                .setName('sell')
                .setDescription('Sell an unequipped owned asset for half price')
                .addStringOption(option =>
                    option
                        .setName('asset_type')
                        .setDescription('Asset kind')
                        .setRequired(true)
                        .addChoices({ name: 'Item', value: 'ITEM' }, { name: 'Weapon', value: 'WEAPON' })
                )
                .addIntegerOption(option =>
                    option
                        .setName('asset_id')
                        .setDescription('ID from /inventory list or /weapon list')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('quantity').setDescription('Item quantity').setMinValue(1).setMaxValue(100)
                )
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        try {
            const rows = await listCatalog({ discordId: interaction.user.id }, { search: focused, limit: 25 });
            return interaction.respond(
                rows.map(row => ({
                    name: `${row.name} — ${formatCurrency(row.price_kreuzer)}`.slice(0, 100),
                    value: row.id,
                }))
            );
        } catch {
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'browse') {
                const rows = await listCatalog(ctx, {
                    search: interaction.options.getString('search') || undefined,
                    category: interaction.options.getString('category') || undefined,
                    limit: 20,
                });
                const categories = [...new Set(rows.map(row => row.category))];
                const sections = categories.map(category => ({
                    name: category,
                    lines: rows
                        .filter(row => row.category === category)
                        .map(
                            row =>
                                `**${row.name}** · ${formatCurrency(row.price_kreuzer)} · ${(row.weight_grams / 1000).toFixed(1)} Stein`
                        ),
                }));
                return interaction.editReply({
                    embeds: buildSectionEmbeds({
                        title: '🛒 Equipment Catalog',
                        description: rows.length
                            ? `**${rows.length} result${rows.length === 1 ? '' : 's'}** · Use autocomplete in \`/shop buy\` to select an entry.`
                            : 'No catalog entries matched.',
                        sections,
                        theme: 'economy',
                    }),
                });
            }
            if (subcommand === 'buy') {
                const result = await buyCatalogItem(ctx, {
                    catalogId: interaction.options.getString('catalog', true),
                    quantity: interaction.options.getInteger('quantity') || 1,
                });
                return interaction.editReply(
                    `✅ Bought **${result.quantity} × ${result.entry.name}** for ${formatCurrency(result.totalPrice)}. Balance: **${formatCurrency(result.wallet.balanceAfter)}**.`
                );
            }
            const result = await sellOwnedAsset(ctx, {
                assetType: interaction.options.getString('asset_type', true),
                assetId: interaction.options.getInteger('asset_id', true),
                quantity: interaction.options.getInteger('quantity') || undefined,
            });
            return interaction.editReply(
                `✅ Sold **${result.quantity} × ${result.name}** for ${formatCurrency(result.saleValue)}. Balance: **${formatCurrency(result.wallet.balanceAfter)}**.`
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Shop command failed');
            return interaction.editReply(`❌ ${error.message || 'Shop operation failed.'}`);
        }
    },
};
