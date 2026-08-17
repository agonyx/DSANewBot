const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { listItems } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const { buildInventoryEmbeds } = require('../utils/embedViews');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const log = createLogger('show-items');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder().setName('show-items').setDescription('Displays the items of your selected character.')
    ),

    async execute(interaction) {
        await deferWithVisibility(interaction);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const itemsList = await listItems({ discordId: interaction.user.id });

            if (!itemsList || itemsList.length === 0) {
                return interaction.editReply({
                    embeds: [
                        createEmbed('inventory')
                            .setTitle(`🎒 ${player.name} — Inventory`)
                            .setDescription(
                                'This inventory is empty. Use `/inventory add` or `/shop buy` to add gear.'
                            ),
                    ],
                });
            }

            const embeds = buildInventoryEmbeds(player, itemsList, interaction.user);

            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);
                    if (avatarBuffer) {
                        const attachment = new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' });
                        embeds[0].setThumbnail('attachment://avatar.png');
                        return interaction.editReply({ embeds, files: [attachment] });
                    }
                } catch {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.editReply({ embeds });
        } catch (error) {
            if (error.status === 404) {
                return interaction.editReply({
                    content: 'You have not selected a character yet. Use `/character select` first.',
                });
            }
            log.error({ error }, 'Error showing items');
            return interaction.editReply({
                content: 'There was an error while fetching your items.',
            });
        }
    },
};
