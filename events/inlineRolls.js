const { Events } = require('discord.js');
const { formatInlineRollReply, resolveInlineRolls } = require('../utils/inlineRolls');
const { createLogger } = require('../utils/logger');
const { rollDice } = require('../utils/rollUtil');

const log = createLogger('inline-rolls');

async function handleInlineRollMessage(message, roller = rollDice) {
    if (message.author?.bot || message.webhookId || !message.content) return undefined;
    const batch = resolveInlineRolls(message.content, roller);
    if (!batch.rolls.length) return undefined;

    try {
        return await message.reply({
            content: formatInlineRollReply(batch),
            allowedMentions: { repliedUser: false },
        });
    } catch (error) {
        log.error({ error, guildId: message.guildId, messageId: message.id }, 'Failed to reply to inline rolls');
        return undefined;
    }
}

module.exports = { name: Events.MessageCreate, execute: handleInlineRollMessage, handleInlineRollMessage };
