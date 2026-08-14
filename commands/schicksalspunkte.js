const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { getResource, spendResource, restoreResource, setResource, RESOURCE_TYPES } = require('../services/resources');
const { createResourceEmbed } = require('../utils/resourceUtils');
const log = createLogger('schicksalspunkte');

const TYPE = 'schicksalspunkte';
const META = RESOURCE_TYPES.schicksalspunkte;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('schicksalspunkte')
        .setDescription('Manage Schicksalspunkte (Fate Points)')
        .addSubcommand(sub =>
            sub
                .setName('spend')
                .setDescription('Spend Schicksalspunkte')
                .addIntegerOption(option =>
                    option.setName('amount').setDescription('Amount to spend').setRequired(false).setMinValue(1)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('restore')
                .setDescription('Restore Schicksalspunkte')
                .addIntegerOption(option =>
                    option.setName('amount').setDescription('Amount to restore').setRequired(false).setMinValue(1)
                )
                .addUserOption(option =>
                    option.setName('target').setDescription('Target character (defaults to yourself)')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Override current Schicksalspunkte value')
                .addIntegerOption(option =>
                    option.setName('value').setDescription('Value to set').setRequired(true).setMinValue(0)
                )
                .addUserOption(option =>
                    option.setName('target').setDescription('Target character (defaults to yourself)')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('show')
                .setDescription('Display current Schicksalspunkte')
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
                const embed = createResourceEmbed(characterName, META, current, current, max, 'show')
                    .setFooter({
                        text: `Requested by ${interaction.user.username}`,
                        iconURL: interaction.user.avatarURL(),
                    })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'spend') {
                const amount = interaction.options.getInteger('amount') || 1;
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
                const amount = interaction.options.getInteger('amount') || 1;
                const { characterName, oldValue, newValue, actualAmount, max } = await restoreResource(ctx, {
                    type: TYPE,
                    amount,
                    targetDiscordId,
                });
                if (actualAmount === 0) {
                    return interaction.editReply({
                        content: `ℹ️ Already at maximum Schicksalspunkte (${oldValue}/${max})`,
                    });
                }
                const embed = createResourceEmbed(characterName, META, oldValue, newValue, max, 'restore')
                    .setFooter({
                        text: `Restored by ${interaction.user.username}`,
                        iconURL: interaction.user.avatarURL(),
                    })
                    .setTimestamp();
                return interaction.editReply({ embeds: [embed] });
            }

            if (subcommand === 'set') {
                const value = interaction.options.getInteger('value');
                const { characterName, oldValue, newValue, max } = await setResource(ctx, {
                    type: TYPE,
                    value,
                    targetDiscordId,
                });
                const embed = createResourceEmbed(characterName, META, oldValue, newValue, max, 'set')
                    .setFooter({ text: `Set by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() })
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
            log.error({ error }, 'Schicksalspunkte command error');
            return interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
