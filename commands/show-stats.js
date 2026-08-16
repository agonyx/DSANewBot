const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getCharacterSheet } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const {
    buildCharacterComponentPayload,
    buildNoticeComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
const { addVisibilityOption, interactionVisibility } = require('../utils/interactionVisibility');
const log = createLogger('show-stats');

module.exports = {
    data: addVisibilityOption(
        new SlashCommandBuilder().setName('show-stats').setDescription("Displays your character's current statistics")
    ),
    async execute(interaction) {
        const visibility = interactionVisibility(interaction);
        await deferForComponents(interaction, visibility);
        try {
            const { player, stats } = await getCharacterSheet({ discordId: interaction.user.id });

            if (!stats) {
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload('❌ No stats found for this character!', { theme: 'error' })
                );
            }

            const files = [];
            let avatarUrl = null;
            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);

                    if (avatarBuffer) {
                        files.push(new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' }));
                        avatarUrl = 'attachment://avatar.png';
                    }
                } catch {
                    // Avatar fetch failed, continue without it
                }
            }

            const payload = buildCharacterComponentPayload(
                { player, stats },
                { ephemeral: visibility.ephemeral, avatarUrl }
            );
            payload.files = files;
            return editDeferredComponents(interaction, payload);
        } catch (error) {
            if (error.status === 404) {
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload('❌ No character selected! Use `/character select` first.', {
                        theme: 'error',
                    })
                );
            }
            log.error({ error }, 'Showstats error');
            return editDeferredComponents(
                interaction,
                buildNoticeComponentPayload('❌ Failed to retrieve character stats!', { theme: 'error' })
            );
        }
    },
};
