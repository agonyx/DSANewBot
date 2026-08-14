const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../db');
const { eq, and } = require('drizzle-orm');
const { players } = require('../db/schema');
const { saveAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const log = createLogger('upload-avatar');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('upload-avatar')
        .setDescription('Upload an image for your character.')
        .addAttachmentOption(option =>
            option.setName('image').setDescription('The image file for your character.').setRequired(true)
        ),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;

            const [player] = await db
                .select({ id: players.id })
                .from(players)
                .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')))
                .limit(1);

            if (!player) {
                return interaction.reply({
                    content: 'No character selected. Use `/character select` first.',
                    ephemeral: true,
                });
            }

            const playerId = player.id;

            const attachment = interaction.options.getAttachment('image');
            if (!attachment) {
                return interaction.reply({ content: 'No image uploaded.', ephemeral: true });
            }

            const imageResponse = await fetch(attachment.url);
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

            const fileExt = attachment.name.split('.').pop();

            let fileName;
            try {
                fileName = await saveAvatar(playerId, imageBuffer, fileExt);
            } catch (err) {
                log.error({ error: err }, 'Upload error');
                return interaction.reply({ content: 'Failed to upload image.', ephemeral: true });
            }

            try {
                await db.update(players).set({ avatar: fileName }).where(eq(players.id, playerId));
            } catch (err) {
                log.error({ error: err }, 'Update error');
                return interaction.reply({ content: 'Failed to update character avatar.', ephemeral: true });
            }

            return interaction.reply({
                content: 'Your character avatar has been updated successfully!',
                ephemeral: true,
            });
        } catch (error) {
            log.error({ error }, 'Error uploading image');
            return interaction.reply({ content: 'There was an error uploading your image.', ephemeral: true });
        }
    },
};
