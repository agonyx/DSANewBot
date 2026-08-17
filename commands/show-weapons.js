const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { listWeapons } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const { buildWeaponEmbeds } = require('../utils/embedViews');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const log = createLogger('show-weapons');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder()
            .setName('show-weapons')
            .setDescription('Displays the weapons of your selected character.')
    ),
    async execute(interaction) {
        await deferWithVisibility(interaction);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const weaponsList = await listWeapons({ discordId: interaction.user.id });

            if (!weaponsList || weaponsList.length === 0) {
                return interaction.editReply({
                    embeds: [
                        createEmbed('combat')
                            .setTitle(`🗡️ ${player.name} — Weapons`)
                            .setDescription('No weapons yet. Use `/weapon add` or `/shop buy` to add one.'),
                    ],
                });
            }

            const embeds = buildWeaponEmbeds(player, weaponsList, interaction.user);

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
            log.error({ error }, 'Error showing weapons');
            return interaction.editReply({ content: 'There was an error while fetching your weapons.' });
        }
    },
};
