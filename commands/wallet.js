const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getWallet, adjustWallet } = require('../services/economy');
const { formatCurrency } = require('../utils/economyUtils');
const { createLogger } = require('../utils/logger');
const log = createLogger('wallet');

const DENOMINATIONS = { DUKATEN: 1000, SILBERTALER: 100, HELLER: 10, KREUZER: 1 };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wallet')
        .setDescription('Show or adjust your selected character’s money')
        .addSubcommand(command => command.setName('show').setDescription('Show balance and recent transactions'))
        .addSubcommand(command =>
            command
                .setName('adjust')
                .setDescription('Record a tabletop money adjustment')
                .addIntegerOption(option =>
                    option.setName('amount').setDescription('Signed amount (negative spends money)').setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('denomination')
                        .setDescription('Coin denomination')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Dukaten', value: 'DUKATEN' },
                            { name: 'Silbertaler', value: 'SILBERTALER' },
                            { name: 'Heller', value: 'HELLER' },
                            { name: 'Kreuzer', value: 'KREUZER' }
                        )
                )
                .addStringOption(option =>
                    option.setName('reason').setDescription('Ledger reason').setRequired(true).setMaxLength(200)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        try {
            if (interaction.options.getSubcommand() === 'adjust') {
                const amount = interaction.options.getInteger('amount', true);
                const denomination = interaction.options.getString('denomination', true);
                const result = await adjustWallet(ctx, {
                    amountKreuzer: amount * DENOMINATIONS[denomination],
                    reason: interaction.options.getString('reason', true),
                });
                return interaction.editReply(
                    `✅ Wallet adjusted by ${amount} ${denomination}. New balance: **${formatCurrency(result.balanceAfter)}**.`
                );
            }
            const wallet = await getWallet(ctx);
            const ledger = wallet.ledger
                .slice(0, 10)
                .map(
                    row =>
                        `${row.amount_kreuzer >= 0 ? '+' : ''}${row.amount_kreuzer} K — ${row.description || row.category}`
                );
            const embed = new EmbedBuilder()
                .setColor(0xd4af37)
                .setTitle(`💰 ${wallet.characterName}`)
                .setDescription(`**${formatCurrency(wallet.balance.totalKreuzer)}**`)
                .addFields({ name: 'Recent ledger', value: ledger.join('\n') || 'No transactions yet.' });
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Wallet command failed');
            return interaction.editReply(`❌ ${error.message || 'Wallet operation failed.'}`);
        }
    },
};
