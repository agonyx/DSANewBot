const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
    createSessionNote,
    deleteSessionNote,
    getSessionNote,
    listSessionNotes,
    updateSessionNote,
} = require('../services/sessionNotes');
const { buildSessionNoteEmbed, buildSessionNoteListEmbeds } = require('../utils/embedViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('session-notes');

function noteOption(subcommand) {
    return subcommand.addStringOption(option =>
        option.setName('note').setDescription('Session note').setAutocomplete(true).setRequired(true)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session-notes')
        .setDescription('Create and manage guild session notes')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Create a session note')
                .addStringOption(option =>
                    option.setName('title').setDescription('Session title').setMaxLength(100).setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('content')
                        .setDescription('Session summary or notes')
                        .setMaxLength(4000)
                        .setRequired(true)
                )
                .addStringOption(option => option.setName('date').setDescription('Optional session date in YYYY-MM-DD'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List saved session notes')
                .addBooleanOption(option =>
                    option.setName('visible').setDescription('Make the list visible to everyone')
                )
        )
        .addSubcommand(subcommand =>
            noteOption(subcommand.setName('show').setDescription('Show one session note')).addBooleanOption(option =>
                option.setName('visible').setDescription('Make the note visible to everyone')
            )
        )
        .addSubcommand(subcommand =>
            noteOption(subcommand.setName('edit').setDescription('Edit a session note'))
                .addStringOption(option =>
                    option.setName('title').setDescription('Replacement title').setMaxLength(100)
                )
                .addStringOption(option =>
                    option.setName('content').setDescription('Replacement session summary').setMaxLength(4000)
                )
                .addStringOption(option => option.setName('date').setDescription('Replacement date in YYYY-MM-DD'))
        )
        .addSubcommand(subcommand => noteOption(subcommand.setName('delete').setDescription('Delete a session note'))),

    async autocomplete(interaction) {
        try {
            if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.respond([]);
            }
            const query = interaction.options.getFocused().toLowerCase();
            const notes = await listSessionNotes({ discordId: interaction.user.id, role: 'DM' }, interaction.guildId);
            return interaction.respond(
                notes
                    .filter(note => note.title.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(note => ({
                        name: `${note.session_date || 'Undated'} · ${note.title}`.slice(0, 100),
                        value: note.id,
                    }))
            );
        } catch (error) {
            log.error({ error }, 'Session note autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        if (!interaction.guildId) {
            return interaction.reply({ content: '❌ Session notes can only be used in a server.', ephemeral: true });
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ Session notes require Manage Server permission.',
                ephemeral: true,
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const visible = ['list', 'show'].includes(subcommand) && (interaction.options.getBoolean('visible') || false);
        await interaction.deferReply({ ephemeral: !visible });
        const ctx = { discordId: interaction.user.id, role: 'DM' };
        const guildId = interaction.guildId;

        try {
            if (subcommand === 'add') {
                const note = await createSessionNote(ctx, {
                    guildId,
                    title: interaction.options.getString('title', true),
                    body: interaction.options.getString('content', true),
                    sessionDate: interaction.options.getString('date') || undefined,
                });
                return interaction.editReply({ embeds: [buildSessionNoteEmbed(note, interaction.user)] });
            }
            if (subcommand === 'list') {
                const notes = await listSessionNotes(ctx, guildId);
                return interaction.editReply({ embeds: buildSessionNoteListEmbeds(notes, interaction.user) });
            }

            const noteId = interaction.options.getString('note', true);
            if (subcommand === 'show') {
                const note = await getSessionNote(ctx, guildId, noteId);
                return interaction.editReply({ embeds: [buildSessionNoteEmbed(note, interaction.user)] });
            }
            if (subcommand === 'edit') {
                const note = await updateSessionNote(ctx, {
                    guildId,
                    noteId,
                    title: interaction.options.getString('title') || undefined,
                    body: interaction.options.getString('content') || undefined,
                    sessionDate: interaction.options.getString('date') || undefined,
                });
                return interaction.editReply({ embeds: [buildSessionNoteEmbed(note, interaction.user)] });
            }

            const note = await deleteSessionNote(ctx, guildId, noteId);
            return interaction.editReply(`✅ Deleted session note **${note.title}**.`);
        } catch (error) {
            log.error({ error, guildId, subcommand }, 'Session note command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage session notes.'}`);
        }
    },
};
