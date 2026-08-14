const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { acceptTrade, cancelTrade, createTrade, declineTrade, listTrades } = require('../services/trades');
const { formatCurrency } = require('../utils/economyUtils');
const { createLogger } = require('../utils/logger');
const log = createLogger('trade');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Offer and resolve character trades')
        .addSubcommand(command =>
            command
                .setName('offer')
                .setDescription('Create a trade offer')
                .addUserOption(option =>
                    option.setName('recipient').setDescription('Trade recipient').setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('offer_kreuzer').setDescription('Currency you offer').setMinValue(0)
                )
                .addIntegerOption(option =>
                    option.setName('request_kreuzer').setDescription('Currency you request').setMinValue(0)
                )
                .addStringOption(option =>
                    option
                        .setName('asset_type')
                        .setDescription('Optional asset you offer')
                        .addChoices({ name: 'Item', value: 'ITEM' }, { name: 'Weapon', value: 'WEAPON' })
                )
                .addIntegerOption(option => option.setName('asset_id').setDescription('Owned asset ID'))
                .addIntegerOption(option =>
                    option.setName('quantity').setDescription('Offered item quantity').setMinValue(1).setMaxValue(100)
                )
                .addIntegerOption(option =>
                    option
                        .setName('expires_hours')
                        .setDescription('Expiry (default 72)')
                        .setMinValue(1)
                        .setMaxValue(168)
                )
        )
        .addSubcommand(command => command.setName('list').setDescription('List your recent trades'))
        .addSubcommand(command =>
            command
                .setName('accept')
                .setDescription('Accept a trade addressed to you')
                .addStringOption(option => option.setName('trade_id').setDescription('Trade UUID').setRequired(true))
        )
        .addSubcommand(command =>
            command
                .setName('decline')
                .setDescription('Decline a trade addressed to you')
                .addStringOption(option => option.setName('trade_id').setDescription('Trade UUID').setRequired(true))
        )
        .addSubcommand(command =>
            command
                .setName('cancel')
                .setDescription('Cancel a trade you initiated')
                .addStringOption(option => option.setName('trade_id').setDescription('Trade UUID').setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'offer') {
                const assetType = interaction.options.getString('asset_type');
                const assetId = interaction.options.getInteger('asset_id');
                if (Boolean(assetType) !== Boolean(assetId)) {
                    return interaction.editReply('❌ asset_type and asset_id must be provided together.');
                }
                const result = await createTrade(ctx, {
                    recipientDiscordId: interaction.options.getUser('recipient', true).id,
                    offeredKreuzer: interaction.options.getInteger('offer_kreuzer') || 0,
                    requestedKreuzer: interaction.options.getInteger('request_kreuzer') || 0,
                    offeredAssets: assetType
                        ? [{ assetType, assetId, quantity: interaction.options.getInteger('quantity') || 1 }]
                        : [],
                    expiresHours: interaction.options.getInteger('expires_hours') || undefined,
                });
                return interaction.editReply(`✅ Trade offered to **${result.recipient}**. ID: \`${result.trade.id}\``);
            }
            if (subcommand === 'list') {
                const rows = await listTrades(ctx);
                const embed = new EmbedBuilder()
                    .setColor(0x4e7d61)
                    .setTitle('🤝 Trades')
                    .setDescription(
                        rows
                            .slice(0, 15)
                            .map(
                                ({ trade, assets }) =>
                                    `\`${trade.id}\` · **${trade.status}**\nOffer ${formatCurrency(trade.offered_kreuzer)} / Request ${formatCurrency(trade.requested_kreuzer)}${assets.length ? ` · ${assets.map(asset => `${asset.quantity}× ${asset.name_snapshot}`).join(', ')}` : ''}`
                            )
                            .join('\n') || 'No trades yet.'
                    );
                return interaction.editReply({ embeds: [embed] });
            }
            const tradeId = interaction.options.getString('trade_id', true);
            const result =
                subcommand === 'accept'
                    ? await acceptTrade(ctx, tradeId)
                    : subcommand === 'decline'
                      ? await declineTrade(ctx, tradeId)
                      : await cancelTrade(ctx, tradeId);
            const status = result.trade?.status || result.status;
            return interaction.editReply(`✅ Trade is now **${status}**.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Trade command failed');
            return interaction.editReply(`❌ ${error.message || 'Trade operation failed.'}`);
        }
    },
};
