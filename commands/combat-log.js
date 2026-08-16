const { SlashCommandBuilder } = require('discord.js');
const { getCombatLog } = require('../services/combat');
const { createLogger } = require('../utils/logger');
const { buildListEmbeds } = require('../utils/embedUtils');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');

const log = createLogger('combat-log');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder()
            .setName('combat-log')
            .setDescription('Show the latest active or ended combat log for this channel')
    ),

    async execute(interaction) {
        await deferWithVisibility(interaction);
        try {
            const result = await getCombatLog({ discordId: interaction.user.id }, { channelId: interaction.channelId });
            const entries = result.log.length > 0 ? result.log : ['No combat events were recorded.'];
            return interaction.editReply({
                embeds: buildListEmbeds({
                    title: `⚔️ Combat Log — ${result.state}`,
                    theme: 'combat',
                    description: `**Round ${result.round} · ${entries.length} event${entries.length === 1 ? '' : 's'}**`,
                    lines: entries.map((entry, index) => `**${index + 1}.** ${entry}`),
                    footer: { text: `Session ${result.id}` },
                    timestamp: result.updatedAt,
                }),
            });
        } catch (error) {
            log.error({ error }, 'Combat log lookup failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
