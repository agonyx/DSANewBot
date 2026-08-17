const { SlashCommandBuilder } = require('discord.js');
const { createLogger } = require('../utils/logger');
const { getResource, spendResource, restoreResource, setResource, RESOURCE_TYPES } = require('../services/resources');
const {
    buildNoticeComponentPayload,
    buildResourceComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
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
        await deferForComponents(interaction, { ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('target');
        const targetDiscordId = targetUser?.id;
        const isSelf = !targetUser || targetUser.id === interaction.user.id;
        const ctx = { discordId: interaction.user.id };

        try {
            if (subcommand === 'show') {
                const { characterName, current, max } = await getResource(ctx, { type: TYPE, targetDiscordId });
                return editDeferredComponents(
                    interaction,
                    buildResourceComponentPayload(characterName, META, current, current, max, 'show')
                );
            }

            if (subcommand === 'spend') {
                const amount = interaction.options.getInteger('amount') || 1;
                const { characterName, oldValue, newValue, max } = await spendResource(ctx, {
                    type: TYPE,
                    amount,
                    targetDiscordId,
                });
                return editDeferredComponents(
                    interaction,
                    buildResourceComponentPayload(characterName, META, oldValue, newValue, max, 'spend')
                );
            }

            if (subcommand === 'restore') {
                const amount = interaction.options.getInteger('amount') || 1;
                const { characterName, oldValue, newValue, actualAmount, max } = await restoreResource(ctx, {
                    type: TYPE,
                    amount,
                    targetDiscordId,
                });
                if (actualAmount === 0) {
                    return editDeferredComponents(
                        interaction,
                        buildNoticeComponentPayload(`ℹ️ Already at maximum Schicksalspunkte (${oldValue}/${max})`)
                    );
                }
                return editDeferredComponents(
                    interaction,
                    buildResourceComponentPayload(characterName, META, oldValue, newValue, max, 'restore')
                );
            }

            if (subcommand === 'set') {
                const value = interaction.options.getInteger('value');
                const { characterName, oldValue, newValue, max } = await setResource(ctx, {
                    type: TYPE,
                    value,
                    targetDiscordId,
                });
                return editDeferredComponents(
                    interaction,
                    buildResourceComponentPayload(characterName, META, oldValue, newValue, max, 'set')
                );
            }
        } catch (error) {
            if (error.status === 404) {
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload(
                        isSelf
                            ? '❌ No character selected! Use `/character select` first.'
                            : '❌ Target has no selected character.',
                        { theme: 'error' }
                    )
                );
            }
            if (error.status === 400) {
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload(`❌ ${error.data?.error || error.message}`, { theme: 'error' })
                );
            }
            log.error({ error }, 'Schicksalspunkte command error');
            return editDeferredComponents(
                interaction,
                buildNoticeComponentPayload(`❌ An error occurred: ${error.message}`, { theme: 'error' })
            );
        }
    },
};
