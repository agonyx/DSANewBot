const { SlashCommandBuilder } = require('discord.js');
const {
    createCharacterRecord,
    deleteCharacterRecord,
    listCharacterRecords,
    updateCharacterRecord,
} = require('../services/characterRecords');
const { buildCharacterRecordListEmbeds } = require('../utils/campaignViews');
const { createLogger } = require('../utils/logger');

const log = createLogger('companion');
const KIND_CHOICES = [
    { name: 'Familiar', value: 'FAMILIAR' },
    { name: 'Companion', value: 'COMPANION' },
    { name: 'Mount / Riding Animal', value: 'MOUNT' },
];

function recordOption(subcommand) {
    return subcommand.addStringOption(option =>
        option.setName('record').setDescription('Companion or mount').setAutocomplete(true).setRequired(true)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('companion')
        .setDescription('Manage familiars, companions, and mounts')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a familiar, companion, or mount')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Record type')
                        .setRequired(true)
                        .addChoices(...KIND_CHOICES)
                )
                .addStringOption(option =>
                    option.setName('name').setDescription('Name').setMaxLength(100).setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('species').setDescription('Species or creature type').setMaxLength(100)
                )
                .addStringOption(option =>
                    option.setName('details').setDescription('Abilities, care, equipment, or notes').setMaxLength(1500)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List companions and mounts')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Optional type filter')
                        .addChoices(...KIND_CHOICES)
                )
                .addBooleanOption(option =>
                    option.setName('visible').setDescription('Make the list visible to everyone')
                )
        )
        .addSubcommand(subcommand =>
            recordOption(subcommand.setName('update').setDescription('Update a companion or mount'))
                .addStringOption(option =>
                    option.setName('details').setDescription('Replacement details').setMaxLength(1500)
                )
                .addStringOption(option =>
                    option
                        .setName('status')
                        .setDescription('Status')
                        .addChoices(
                            { name: 'Active', value: 'ACTIVE' },
                            { name: 'Resting', value: 'RESTING' },
                            { name: 'Unavailable', value: 'UNAVAILABLE' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            recordOption(subcommand.setName('delete').setDescription('Delete a companion or mount'))
        ),

    async autocomplete(interaction) {
        try {
            const query = interaction.options.getFocused().toLowerCase();
            const records = (await listCharacterRecords({ discordId: interaction.user.id })).filter(record =>
                ['FAMILIAR', 'COMPANION', 'MOUNT'].includes(record.kind)
            );
            return interaction.respond(
                records
                    .filter(record => record.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(record => ({
                        name: `${record.kind.toLowerCase()} · ${record.name}`.slice(0, 100),
                        value: record.id,
                    }))
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
            if (subcommand === 'add') {
                const record = await createCharacterRecord(ctx, {
                    kind: interaction.options.getString('type', true),
                    name: interaction.options.getString('name', true),
                    description: interaction.options.getString('details') || undefined,
                    data: { species: interaction.options.getString('species') || '' },
                });
                return interaction.editReply(`✅ Added ${record.kind.toLowerCase()} **${record.name}**.`);
            }
            if (subcommand === 'list') {
                const kind = interaction.options.getString('type') || undefined;
                const records = kind
                    ? await listCharacterRecords(ctx, kind)
                    : (await listCharacterRecords(ctx)).filter(record =>
                          ['FAMILIAR', 'COMPANION', 'MOUNT'].includes(record.kind)
                      );
                return interaction.editReply({
                    embeds: buildCharacterRecordListEmbeds('🐾 Companions & Mounts', records, interaction.user),
                });
            }
            const recordId = interaction.options.getString('record', true);
            if (subcommand === 'update') {
                const existing = (await listCharacterRecords(ctx)).find(record => record.id === recordId);
                if (!existing || !['FAMILIAR', 'COMPANION', 'MOUNT'].includes(existing.kind))
                    throw Object.assign(new Error('Companion not found'), { status: 404 });
                const details = interaction.options.getString('details');
                const record = await updateCharacterRecord(ctx, {
                    recordId,
                    kind: existing.kind,
                    status: interaction.options.getString('status') || undefined,
                    data: details === null ? existing.data : { ...existing.data, description: details },
                });
                return interaction.editReply(`✅ Updated **${record.name}**.`);
            }
            const existing = (await listCharacterRecords(ctx)).find(record => record.id === recordId);
            if (!existing || !['FAMILIAR', 'COMPANION', 'MOUNT'].includes(existing.kind))
                throw Object.assign(new Error('Companion not found'), { status: 404 });
            const deleted = await deleteCharacterRecord(ctx, recordId, existing.kind);
            return interaction.editReply(`✅ Deleted **${deleted.name}**.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Companion command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage companions.'}`);
        }
    },
};
