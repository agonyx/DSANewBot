const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { getResource, spendResource, restoreResource, RESOURCE_TYPES } = require('../services/resources');
const { createResourceEmbed } = require('../utils/resourceUtils');
const log = createLogger('kap');

const TYPE = 'kap';
const META = RESOURCE_TYPES.kap;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kap')
        .setDescription('Manage Karmapunkte (Karma Points)')
        .addSubcommand(sub =>
            sub
                .setName('spend')
                .setDescription('Spend Karmapunkte')
                .addIntegerOption(option =>
                    option.setName('amount').setDescription('Amount to spend').setRequired(true).setMinValue(1)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('restore')
                .setDescription('Restore Karmapunkte')
                .addIntegerOption(option =>
                    option.setName('amount').setDescription('Amount to restore').setRequired(true).setMinValue(1)
                )
                .addUserOption(option =>
                    option.setName('target').setDescription('Target character (defaults to yourself)')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('show')
                .setDescription('Display current Karmapunkte')
                .addUserOption(option =>
                    option.setName('target').setDescription('Target character (defaults to yourself)')
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('target');
        const targetDiscordId = targetUser?.id;
        const isSelf = !targetUser || targetUser.id === interaction.user.id;
        const ctx = { discordId: interaction.user.id };

        try {
            if (subcommand === 'show') {
                const { characterName, current, max } = await getResource(ctx, { type: TYPE, targetDiscordId });
                if (max === 0) {
                    return interaction.editReply({
                        content: '❌ This character has no Karmalkraft. Only Geweihte (blessed) have KaP.',
                    });
                }
                const embed = createResourceEmbed(characterName, META, current, current, max, 'show')
                    .setFooter({
                        text: `Requested by ${interaction.user.username}`,
                        iconURL: interaction.user.avatarURL(),
                    })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'spend') {
                const amount = interaction.options.getInteger('amount');
                const { characterName, oldValue, newValue, max } = await spendResource(ctx, {
                    type: TYPE,
                    amount,
                    targetDiscordId,
                });
                const embed = createResourceEmbed(characterName, META, oldValue, newValue, max, 'spend')
                    .setFooter({ text: `Used by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'restore') {
                const amount = interaction.options.getInteger('amount');
                const { characterName, oldValue, newValue, actualAmount, max } = await restoreResource(ctx, {
                    type: TYPE,
                    amount,
                    targetDiscordId,
                });
                if (actualAmount === 0) {
                    return interaction.editReply({ content: `ℹ️ Already at maximum Karmapunkte (${oldValue}/${max})` });
                }
                const embed = createResourceEmbed(characterName, META, oldValue, newValue, max, 'restore')
                    .setFooter({
                        text: `Restored by ${interaction.user.username}`,
                        iconURL: interaction.user.avatarURL(),
                    })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            if (error.status === 404) {
                return interaction.editReply({
                    content: isSelf
                        ? '❌ No character selected! Use `/character select` first.'
                        : '❌ Target has no selected character.',
                });
            }
            if (error.status === 400) {
                return interaction.editReply({ content: `❌ ${error.data?.error || error.message}` });
            }
            log.error({ error }, 'KaP command error');
            return interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
