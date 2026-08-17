const { SlashCommandBuilder } = require('discord.js');
const { getLatestImportReport } = require('../services/characterRecords');
const { createEmbed, truncateText } = require('../utils/embedUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('import-report')
        .setDescription('Show unresolved fields from the selected character import'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const report = await getLatestImportReport({ discordId: interaction.user.id });
            const fields = Array.isArray(report.data.fields) ? report.data.fields : [];
            const catalog = Array.isArray(report.data.catalog) ? report.data.catalog : [];
            const embed = createEmbed('warning')
                .setTitle('Unresolved character import data')
                .setDescription(
                    `Profile: **${report.data.profileId || 'JSON'}** · Fields: **${report.data.fieldCount || fields.length}**`
                )
                .addFields(
                    { name: 'Fields', value: truncateText(fields.join('\n') || 'None', 1024) },
                    {
                        name: 'Catalog entries',
                        value: truncateText(
                            catalog.map(entry => `${entry.name} — ${entry.status}`).join('\n') || 'None',
                            1024
                        ),
                    }
                );
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
