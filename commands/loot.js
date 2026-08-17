const { SlashCommandBuilder } = require('discord.js');
const { awardLoot, cancelLootPool, generateLoot, getLootPool, listLootPools } = require('../services/loot');
const { formatCurrency } = require('../utils/economyUtils');
const { createLogger } = require('../utils/logger');
const { buildListEmbeds, buildSectionEmbeds } = require('../utils/embedUtils');
const log = createLogger('loot');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loot')
        .setDescription('Generate and distribute post-combat loot')
        .addSubcommand(command =>
            command
                .setName('generate')
                .setDescription('Generate a loot pool for an ended combat (DM)')
                .addStringOption(option =>
                    option.setName('session_id').setDescription('Combat session UUID').setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('tier').setDescription('Loot tier').setRequired(true).setMinValue(1).setMaxValue(3)
                )
                .addStringOption(option => option.setName('name').setDescription('Loot pool name').setMaxLength(100))
        )
        .addSubcommand(command =>
            command
                .setName('list')
                .setDescription('List loot pools for a combat')
                .addStringOption(option =>
                    option.setName('session_id').setDescription('Combat session UUID').setRequired(true)
                )
        )
        .addSubcommand(command =>
            command
                .setName('show')
                .setDescription('Show a loot pool')
                .addStringOption(option => option.setName('pool_id').setDescription('Loot pool UUID').setRequired(true))
        )
        .addSubcommand(command =>
            command
                .setName('award')
                .setDescription('Award currency and/or an entry to a participant (DM)')
                .addStringOption(option => option.setName('pool_id').setDescription('Loot pool UUID').setRequired(true))
                .addUserOption(option =>
                    option.setName('recipient').setDescription('Combat participant').setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('currency').setDescription('Kreuzer to award').setMinValue(0)
                )
                .addStringOption(option => option.setName('entry_id').setDescription('Loot entry UUID'))
                .addIntegerOption(option =>
                    option.setName('quantity').setDescription('Entry quantity').setMinValue(1).setMaxValue(100)
                )
        )
        .addSubcommand(command =>
            command
                .setName('cancel')
                .setDescription('Cancel an open loot pool (DM)')
                .addStringOption(option => option.setName('pool_id').setDescription('Loot pool UUID').setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'generate') {
                const result = await generateLoot(ctx, {
                    sessionId: interaction.options.getString('session_id', true),
                    tier: interaction.options.getInteger('tier', true),
                    name: interaction.options.getString('name') || undefined,
                });
                return interaction.editReply(
                    `✅ Generated **${result.pool.name}** with ${formatCurrency(result.pool.currency_remaining_kreuzer)} and ${result.entries.length} item(s). Pool: \`${result.pool.id}\``
                );
            }
            if (subcommand === 'list') {
                const rows = await listLootPools(ctx, interaction.options.getString('session_id', true));
                return interaction.editReply({
                    embeds: buildListEmbeds({
                        title: '🎁 Loot Pools',
                        theme: 'economy',
                        lines: rows.map(row => `**${row.name}** · Tier ${row.tier} · ${row.status}\nID: \`${row.id}\``),
                        emptyMessage: 'No loot pools for this combat.',
                    }),
                });
            }
            if (subcommand === 'show') {
                const result = await getLootPool(ctx, interaction.options.getString('pool_id', true));
                return interaction.editReply({
                    embeds: buildSectionEmbeds({
                        title: `🎁 ${result.pool.name}`,
                        description: `**${result.pool.status}** · Tier ${result.pool.tier} · ${formatCurrency(result.pool.currency_remaining_kreuzer)} remaining`,
                        sections: [
                            {
                                name: 'Entries',
                                lines: result.entries.length
                                    ? result.entries.map(
                                          row =>
                                              `**${row.entry.quantity_remaining}× ${row.catalog.name}**\nID: \`${row.entry.id}\``
                                      )
                                    : ['No entries remain.'],
                            },
                        ],
                        theme: 'economy',
                    }),
                });
            }
            if (subcommand === 'award') {
                const result = await awardLoot(ctx, {
                    poolId: interaction.options.getString('pool_id', true),
                    targetDiscordId: interaction.options.getUser('recipient', true).id,
                    currencyKreuzer: interaction.options.getInteger('currency') || 0,
                    entryId: interaction.options.getString('entry_id') || undefined,
                    quantity: interaction.options.getInteger('quantity') || 1,
                });
                return interaction.editReply(
                    `✅ Awarded loot to **${result.target}**. Pool status: **${result.pool.status}**.`
                );
            }
            const result = await cancelLootPool(ctx, interaction.options.getString('pool_id', true));
            return interaction.editReply(`✅ Loot pool **${result.name}** cancelled.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Loot command failed');
            return interaction.editReply(`❌ ${error.message || 'Loot operation failed.'}`);
        }
    },
};
