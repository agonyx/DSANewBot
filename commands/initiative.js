const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
    addInitiativeEntry,
    advanceInitiative,
    endInitiativeTracker,
    getInitiativeTracker,
    removeInitiativeEntry,
    startInitiativeTracker,
} = require('../services/initiativeTrackers');
const { buildInitiativeTrackerEmbeds } = require('../utils/embedViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('initiative');

function trackerScope(interaction) {
    if (!interaction.guildId || !interaction.channelId) throw new Error('Initiative trackers require a server channel');
    return { guildId: interaction.guildId, channelId: interaction.channelId };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initiative')
        .setDescription('Track initiative outside a full combat session')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a tracker and roll initiative for the server party')
                .addStringOption(option =>
                    option.setName('name').setDescription('Scene or challenge name').setMaxLength(80)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('show').setDescription('Show the active tracker'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a manual participant')
                .addStringOption(option =>
                    option.setName('name').setDescription('Participant name').setMaxLength(80).setRequired(true)
                )
                .addIntegerOption(option =>
                    option
                        .setName('initiative')
                        .setDescription('Final initiative total')
                        .setMinValue(-100)
                        .setMaxValue(500)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a participant')
                .addStringOption(option =>
                    option
                        .setName('participant')
                        .setDescription('Participant to remove')
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand => subcommand.setName('next').setDescription('Advance to the next participant'))
        .addSubcommand(subcommand => subcommand.setName('end').setDescription('End and delete the active tracker')),

    async autocomplete(interaction) {
        try {
            const tracker = await getInitiativeTracker(
                { discordId: interaction.user.id, role: 'DM' },
                interaction.guildId,
                interaction.channelId
            );
            const query = interaction.options.getFocused().toLowerCase();
            return interaction.respond(
                tracker.entries
                    .filter(entry => entry.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(entry => ({ name: `${entry.name} (${entry.total})`.slice(0, 100), value: entry.id }))
            );
        } catch (error) {
            log.error({ error }, 'Initiative autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ Initiative tracker management requires Manage Server permission.',
                ephemeral: true,
            });
        }

        let commandScope;
        try {
            commandScope = trackerScope(interaction);
        } catch (error) {
            return interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply();
        const ctx = { discordId: interaction.user.id, role: 'DM' };
        try {
            let tracker;
            if (subcommand === 'start') {
                tracker = await startInitiativeTracker(ctx, {
                    ...commandScope,
                    title: interaction.options.getString('name') || undefined,
                });
            } else if (subcommand === 'show') {
                tracker = await getInitiativeTracker(ctx, commandScope.guildId, commandScope.channelId);
            } else if (subcommand === 'add') {
                tracker = await addInitiativeEntry(ctx, {
                    ...commandScope,
                    name: interaction.options.getString('name', true),
                    initiative: interaction.options.getInteger('initiative', true),
                });
            } else if (subcommand === 'remove') {
                tracker = await removeInitiativeEntry(ctx, {
                    ...commandScope,
                    entryId: interaction.options.getString('participant', true),
                });
            } else if (subcommand === 'next') {
                tracker = await advanceInitiative(ctx, commandScope.guildId, commandScope.channelId);
            } else {
                const ended = await endInitiativeTracker(ctx, commandScope.guildId, commandScope.channelId);
                return interaction.editReply(`✅ Ended initiative tracker **${ended.title}**.`);
            }
            return interaction.editReply({ embeds: buildInitiativeTrackerEmbeds(tracker, interaction.user) });
        } catch (error) {
            log.error({ error, ...commandScope, subcommand }, 'Initiative command failed');
            return interaction.editReply(
                `❌ ${error.status ? error.message : 'Failed to update or load the initiative tracker.'}`
            );
        }
    },
};
