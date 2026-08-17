const { SlashCommandBuilder } = require('discord.js');
const {
    advanceCharacterProject,
    deleteCharacterRecord,
    listAlchemyRecipes,
    listCharacterRecords,
    startAlchemyBrew,
} = require('../services/characterRecords');
const { buildCampaignRecordListEmbeds, buildCharacterRecordListEmbeds } = require('../utils/campaignViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('alchemy');

function brewOption(subcommand) {
    return subcommand.addStringOption(option =>
        option.setName('brew').setDescription('Active brew').setAutocomplete(true).setRequired(true)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alchemy')
        .setDescription('Brew potions from campaign recipes')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('recipes')
                .setDescription('List available recipes')
                .addBooleanOption(option =>
                    option.setName('visible').setDescription('Make recipes visible to everyone')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('brew')
                .setDescription('Start brewing a potion')
                .addStringOption(option =>
                    option.setName('recipe').setDescription('Alchemy recipe').setAutocomplete(true).setRequired(true)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List active and completed brews'))
        .addSubcommand(subcommand =>
            brewOption(subcommand.setName('progress').setDescription('Add brewing progress')).addIntegerOption(option =>
                option
                    .setName('amount')
                    .setDescription('Progress to add')
                    .setMinValue(1)
                    .setMaxValue(100)
                    .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
            brewOption(subcommand.setName('cancel').setDescription('Cancel and delete a brew'))
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            const query = focused.value.toLowerCase();
            const rows =
                focused.name === 'recipe'
                    ? await listAlchemyRecipes(interaction.guildId)
                    : await listCharacterRecords({ discordId: interaction.user.id }, 'ALCHEMY_BREW');
            return interaction.respond(
                rows
                    .filter(row => row.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(row => ({ name: row.name, value: row.id }))
            );
        } catch {
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        if (!interaction.guildId)
            return interaction.reply({ content: '❌ Alchemy requires a server campaign.', ephemeral: true });
        const subcommand = interaction.options.getSubcommand();
        const visible = subcommand === 'recipes' && (interaction.options.getBoolean('visible') || false);
        await interaction.deferReply({ ephemeral: !visible });
        const ctx = { discordId: interaction.user.id };
        try {
            if (subcommand === 'recipes') {
                const recipes = await listAlchemyRecipes(interaction.guildId);
                return interaction.editReply({
                    embeds: buildCampaignRecordListEmbeds('ALCHEMY_RECIPE', recipes, interaction.user),
                });
            }
            if (subcommand === 'brew') {
                const record = await startAlchemyBrew(ctx, {
                    guildId: interaction.guildId,
                    recipeId: interaction.options.getString('recipe', true),
                });
                return interaction.editReply(
                    `⚗️ Started **${record.name}** (${record.data.target} progress required).`
                );
            }
            if (subcommand === 'list') {
                const brews = await listCharacterRecords(ctx, 'ALCHEMY_BREW');
                return interaction.editReply({
                    embeds: buildCharacterRecordListEmbeds('⚗️ Potion Brews', brews, interaction.user),
                });
            }
            const brewId = interaction.options.getString('brew', true);
            if (subcommand === 'progress') {
                const brew = await advanceCharacterProject(
                    ctx,
                    brewId,
                    'ALCHEMY_BREW',
                    interaction.options.getInteger('amount', true)
                );
                return interaction.editReply(
                    `⚗️ **${brew.name}**: ${brew.data.progress}/${brew.data.target} (${brew.status}).`
                );
            }
            const deleted = await deleteCharacterRecord(ctx, brewId, 'ALCHEMY_BREW');
            return interaction.editReply(`✅ Cancelled **${deleted.name}**.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Alchemy command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage alchemy.'}`);
        }
    },
};
