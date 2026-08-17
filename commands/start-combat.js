const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../db');
const { eq, and, inArray } = require('drizzle-orm');
const { combatSessions } = require('../db/schema');
const { createSetupActionRows } = require('../utils/combatComponents');
const {
    buildCombatSetupComponentPayload,
    buildNoticeComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
const { createLogger } = require('../utils/logger');
const log = createLogger('start-combat');

async function executeStartCombat(interaction) {
    try {
        await deferForComponents(interaction);
    } catch (deferError) {
        log.error({ error: deferError }, 'Failed to defer reply');
        return;
    }

    const channelId = interaction.channelId;
    const dmUserId = interaction.user.id;
    const dmUsername = interaction.user.username;

    try {
        const [existingSession] = await db
            .select()
            .from(combatSessions)
            .where(
                and(
                    eq(combatSessions.channel_id, channelId),
                    inArray(combatSessions.state, ['SETUP', 'RUNNING', 'PAUSED'])
                )
            )
            .limit(1);

        if (existingSession) {
            return editDeferredComponents(
                interaction,
                buildNoticeComponentPayload('⚠️ An active combat session already exists in this channel.')
            );
        }

        const [session] = await db
            .insert(combatSessions)
            .values({
                channel_id: channelId,
                dm_user_id: dmUserId,
                state: 'SETUP',
            })
            .returning();

        if (!session) {
            log.error('Failed to create session');
            return editDeferredComponents(
                interaction,
                buildNoticeComponentPayload('❌ Failed to create combat session.', { theme: 'error' })
            );
        }

        const sessionId = session.id;
        log.info({ sessionId }, 'Combat session created successfully');

        const initialActionRows = createSetupActionRows(sessionId, false);
        const setupMessage = await editDeferredComponents(
            interaction,
            buildCombatSetupComponentPayload(sessionId, dmUsername, [], false, { actionRows: initialActionRows })
        );

        try {
            await db
                .update(combatSessions)
                .set({ message_id: setupMessage.id })
                .where(eq(combatSessions.id, sessionId));
        } catch (updateError) {
            log.error(
                { error: updateError, sessionId, messageId: setupMessage.id },
                'Failed to update session with message ID'
            );
            await interaction.followUp({
                content: '⚠️ Session created, but failed to store message link. Combat might not update correctly.',
                ephemeral: true,
            });
        }
    } catch (error) {
        log.error({ error }, 'Error in executeStartCombat function');
        try {
            await editDeferredComponents(
                interaction,
                buildNoticeComponentPayload(`❌ An error occurred while starting combat setup: ${error.message}`, {
                    theme: 'error',
                })
            );
        } catch (replyError) {
            log.error({ error: replyError }, 'Failed to send error reply');
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start-combat')
        .setDescription('Initiates the setup phase for a new combat encounter in this channel.')
        .setDMPermission(false),
    execute: executeStartCombat,
};
