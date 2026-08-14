const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { listItems } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const { buildInventoryEmbeds } = require('../utils/embedViews');
const log = createLogger('show-items');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-items')
        .setDescription('Displays the items of your selected character.')
        .addBooleanOption(option =>
            option.setName('visible').setDescription('Make the response visible to everyone in the channel.')
        ),

    async execute(interaction) {
        const visible = interaction.options.getBoolean('visible', false);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const itemsList = await listItems({ discordId: interaction.user.id });

            if (!itemsList || itemsList.length === 0) {
                return interaction.reply({
                    embeds: [
                        createEmbed('inventory')
                            .setTitle(`🎒 ${player.name} — Inventory`)
                            .setDescription(
                                'This inventory is empty. Use `/inventory add` or `/shop buy` to add gear.'
                            ),
                    ],
                    ephemeral: true,
                });
            }

            const embeds = buildInventoryEmbeds(player, itemsList, interaction.user);

            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);
                    if (avatarBuffer) {
                        const attachment = new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' });
                        embeds[0].setThumbnail('attachment://avatar.png');
                        return interaction.reply({ embeds, files: [attachment], ephemeral: !visible });
                    }
                } catch (e) {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.reply({ embeds, ephemeral: !visible });
        } catch (error) {
            if (error.status === 404) {
                return interaction.reply({
                    content: 'You have not selected a character yet. Use `/character select` first.',
                    ephemeral: true,
                });
            }
            log.error({ error }, 'Error showing items');
            return interaction.reply({
                content: 'There was an error while fetching your items.',
                ephemeral: true,
            });
        }
    },
};
