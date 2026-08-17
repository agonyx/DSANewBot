const { SlashCommandBuilder } = require('discord.js');
const { cancelCasting, listCastings } = require('../services/supernatural');
const { createLogger } = require('../utils/logger');

const log = createLogger('cancel-casting');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cancel-casting')
        .setDescription('Interrupt a pending ritual or ceremony and recover half its resource cost')
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
                        name: `${row.ability_name} — ${row.resource_cost} points committed`.slice(0, 100),
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
            const result = await cancelCasting(
                { discordId: interaction.user.id },
                interaction.options.getString('casting')
            );
            return interaction.editReply(
                `✅ **${result.casting.ability_name}** was interrupted. ` +
                    `${result.refund} points refunded; ${result.retainedCost} retained as the interruption cost.`
            );
        } catch (error) {
            log.error({ error }, 'Cancel casting failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
