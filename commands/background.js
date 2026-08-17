const { SlashCommandBuilder } = require('discord.js');
const { listCharacterRecords, setCharacterBackground } = require('../services/characterRecords');
const { buildCharacterRecordListEmbeds } = require('../utils/campaignViews');
const { createLogger } = require('../utils/logger');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');

const log = createLogger('background');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('background')
        .setDescription('Manage culture and profession background')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the selected character background')
                .addStringOption(option =>
                    option.setName('culture').setDescription('Culture').setMaxLength(100).setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('profession').setDescription('Profession').setMaxLength(100).setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('notes').setDescription('Background notes').setMaxLength(1000)
                )
        )
        .addSubcommand(subcommand =>
            addVisibilityOption(subcommand.setName('show').setDescription('Show the selected character background'))
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'show') await deferWithVisibility(interaction);
        else await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        try {
            if (subcommand === 'set') {
                const record = await setCharacterBackground(ctx, {
                    culture: interaction.options.getString('culture', true),
                    profession: interaction.options.getString('profession', true),
                    notes: interaction.options.getString('notes') || undefined,
                });
                return interaction.editReply(
                    `✅ Background set to **${record.data.culture} · ${record.data.profession}**.`
                );
            }
            const records = await listCharacterRecords(ctx, 'BACKGROUND');
            return interaction.editReply({
                embeds: buildCharacterRecordListEmbeds('📚 Culture & Profession', records, interaction.user),
            });
        } catch (error) {
            log.error({ error, subcommand }, 'Background command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage background.'}`);
        }
    },
};
