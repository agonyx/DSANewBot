const { SlashCommandBuilder } = require('discord.js');
const { completeCasting, listCastings } = require('../services/supernatural');
const { createLogger } = require('../utils/logger');

const log = createLogger('complete-casting');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete-casting')
        .setDescription('Complete a finished ritual or ceremony and apply its effect')
        .addStringOption(option =>
            option.setName('casting').setDescription('Pending casting').setRequired(true).setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused().toLowerCase();
            const rows = await listCastings({ discordId: interaction.user.id });
            return interaction.respond(
                rows
                    .filter(row => row.status === 'PENDING' && row.ability_name.toLowerCase().includes(focused))
                    .slice(0, 25)
                    .map(row => ({
                        name: `${row.ability_name} — ${row.completes_at?.toISOString() || 'pending'}`.slice(0, 100),
                        value: row.id,
                    }))
            );
        } catch (error) {
            log.error({ error }, 'Casting autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await completeCasting(
                { discordId: interaction.user.id },
                interaction.options.getString('casting')
            );
            return interaction.editReply(`✅ **${result.casting.ability_name}** completed and its effect was applied.`);
        } catch (error) {
            log.error({ error }, 'Complete casting failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
