const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { listWeapons } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const { buildWeaponEmbeds } = require('../utils/embedViews');
const log = createLogger('show-weapons');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-weapons')
        .setDescription('Displays the weapons of your selected character.')
        .addBooleanOption(option =>
            option.setName('visible').setDescription('Make the response visible to everyone in the channel.')
        ),
    async execute(interaction) {
        const visible = interaction.options.getBoolean('visible', false);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const weaponsList = await listWeapons({ discordId: interaction.user.id });

            if (!weaponsList || weaponsList.length === 0) {
                return interaction.reply({
                    embeds: [
                        createEmbed('combat')
                            .setTitle(`🗡️ ${player.name} — Weapons`)
                            .setDescription('No weapons yet. Use `/weapon add` or `/shop buy` to add one.'),
                    ],
                    ephemeral: true,
                });
            }

            const embeds = buildWeaponEmbeds(player, weaponsList, interaction.user);

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
            log.error({ error }, 'Error showing weapons');
            return interaction.reply({ content: 'There was an error while fetching your weapons.', ephemeral: true });
        }
    },
};
