const { SlashCommandBuilder } = require('discord.js');
const {
    advanceCharacterProject,
    deleteCharacterRecord,
    listCharacterRecords,
    startCraftingProject,
} = require('../services/characterRecords');
const { buildCharacterRecordListEmbeds } = require('../utils/campaignViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('crafting');

function projectOption(subcommand) {
    return subcommand.addStringOption(option =>
        option.setName('project').setDescription('Crafting project').setAutocomplete(true).setRequired(true)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crafting')
        .setDescription('Track character crafting projects')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a crafting project')
                .addStringOption(option =>
                    option.setName('name').setDescription('Project name').setMaxLength(100).setRequired(true)
                )
                .addIntegerOption(option =>
                    option
                        .setName('target')
                        .setDescription('Required progress')
                        .setMinValue(1)
                        .setMaxValue(100000)
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('materials').setDescription('Required materials').setMaxLength(1000)
                )
                .addStringOption(option =>
                    option.setName('description').setDescription('Project details').setMaxLength(1500)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List crafting projects')
                .addBooleanOption(option =>
                    option.setName('visible').setDescription('Make the list visible to everyone')
                )
        )
        .addSubcommand(subcommand =>
            projectOption(subcommand.setName('progress').setDescription('Add crafting progress')).addIntegerOption(
                option =>
                    option
                        .setName('amount')
                        .setDescription('Progress to add')
                        .setMinValue(1)
                        .setMaxValue(100000)
                        .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
            projectOption(subcommand.setName('cancel').setDescription('Cancel and delete a project'))
        ),

    async autocomplete(interaction) {
        try {
            const query = interaction.options.getFocused().toLowerCase();
            const projects = await listCharacterRecords({ discordId: interaction.user.id }, 'CRAFTING_PROJECT');
            return interaction.respond(
                projects
                    .filter(project => project.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(project => ({ name: project.name, value: project.id }))
            );
        } catch {
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const visible = subcommand === 'list' && (interaction.options.getBoolean('visible') || false);
        await interaction.deferReply({ ephemeral: !visible });
        const ctx = { discordId: interaction.user.id };
        try {
            if (subcommand === 'start') {
                const project = await startCraftingProject(ctx, {
                    name: interaction.options.getString('name', true),
                    target: interaction.options.getInteger('target', true),
                    materials: interaction.options.getString('materials') || undefined,
                    description: interaction.options.getString('description') || undefined,
                });
                return interaction.editReply(`🔨 Started **${project.name}**.`);
            }
            if (subcommand === 'list') {
                const projects = await listCharacterRecords(ctx, 'CRAFTING_PROJECT');
                return interaction.editReply({
                    embeds: buildCharacterRecordListEmbeds('🔨 Crafting Projects', projects, interaction.user),
                });
            }
            const projectId = interaction.options.getString('project', true);
            if (subcommand === 'progress') {
                const project = await advanceCharacterProject(
                    ctx,
                    projectId,
                    'CRAFTING_PROJECT',
                    interaction.options.getInteger('amount', true)
                );
                return interaction.editReply(
                    `🔨 **${project.name}**: ${project.data.progress}/${project.data.target} (${project.status}).`
                );
            }
            const deleted = await deleteCharacterRecord(ctx, projectId, 'CRAFTING_PROJECT');
            return interaction.editReply(`✅ Cancelled **${deleted.name}**.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Crafting command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage crafting.'}`);
        }
    },
};
