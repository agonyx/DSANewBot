const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCombatLog } = require('../services/combat');
const { createLogger } = require('../utils/logger');

const log = createLogger('combat-log');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combat-log')
        .setDescription('Show the latest active or ended combat log for this channel')
        .addBooleanOption(option =>
            option.setName('visible').setDescription('Make the combat log visible to the channel')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: !interaction.options.getBoolean('visible') });
        try {
            const result = await getCombatLog({ discordId: interaction.user.id }, { channelId: interaction.channelId });
            const entries = result.log.length > 0 ? result.log : ['No combat events were recorded.'];
            const embed = new EmbedBuilder()
                .setColor(0x8b0000)
                .setTitle(`⚔️ Combat Log — ${result.state}`)
                .setDescription(
                    entries
                        .map((entry, index) => `${index + 1}. ${entry}`)
                        .join('\n')
                        .slice(0, 4096)
                )
                .setFooter({ text: `Round ${result.round} • Session ${result.id}` })
                .setTimestamp(result.updatedAt);
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Combat log lookup failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
