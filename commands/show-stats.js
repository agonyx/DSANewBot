const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCharacterSheet } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { buildCharacterStatsEmbed } = require('../utils/embedViews');
const log = createLogger('show-stats');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-stats')
        .setDescription("Displays your character's current statistics")
        .addBooleanOption(option => option.setName('visible').setDescription('Make the response visible to everyone')),
    async execute(interaction) {
        try {
            const visible = interaction.options.getBoolean('visible') || false;

            const { player, stats } = await getCharacterSheet({ discordId: interaction.user.id });

            if (!stats) {
                return interaction.reply({
                    content: '❌ No stats found for this character!',
                    ephemeral: true,
                });
            }

            const statsEmbed = buildCharacterStatsEmbed(player, stats, interaction.user);

            const files = [];
            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);

                    if (avatarBuffer) {
                        files.push(new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' }));
                        statsEmbed.setThumbnail('attachment://avatar.png');
                    }
                } catch (e) {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.reply({
                embeds: [statsEmbed],
                files: files,
                ephemeral: !visible,
            });
        } catch (error) {
            if (error.status === 404) {
                return interaction.reply({
                    content: '❌ No character selected! Use `/character select` first.',
                    ephemeral: true,
                });
            }
            log.error({ error }, 'Showstats error');
            return interaction.reply({
                content: '❌ Failed to retrieve character stats!',
                ephemeral: true,
            });
        }
    },
};
