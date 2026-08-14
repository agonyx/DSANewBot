const { createEmbed, progressBar } = require('./embedUtils');

/**
 * Presentation helpers for resource embeds. The DB-touching logic
 * (getPlayerWithStats/spendResource/restoreResource/setResource + RESOURCE_TYPES)
 * now lives in services/resources.ts; this file is Discord-rendering only.
 */

/**
 * Creates a visual resource bar string.
 * @param {number} current - Current value
 * @param {number} max - Maximum value
 * @param {number} [length=10] - Bar length in characters
 * @returns {string} Bar like ■■■■□□□□□□
 */
function createResourceBar(current, max, length = 10) {
    return progressBar(current, max, length);
}

/**
 * Creates a Discord embed for a resource change.
 * @param {string} playerName - Character name
 * @param {object} resourceType - Entry from RESOURCE_TYPES (services/resources)
 * @param {number} oldValue - Value before change
 * @param {number} newValue - Value after change
 * @param {number} maxValue - Maximum value
 * @param {'spend'|'restore'|'set'|'show'} action - What action was taken
 * @returns {EmbedBuilder}
 */
function createResourceEmbed(playerName, resourceType, oldValue, newValue, maxValue, action) {
    const bar = createResourceBar(newValue, maxValue);
    const percentage = maxValue > 0 ? Math.round((newValue / maxValue) * 100) : 0;

    const titles = {
        spend: `${resourceType.emoji} ${resourceType.label} Spent`,
        restore: `${resourceType.emoji} ${resourceType.label} Restored`,
        set: `${resourceType.emoji} ${resourceType.label} Set`,
        show: `${resourceType.emoji} ${resourceType.label}`,
    };

    const theme = resourceType.key === 'asp' ? 'magic' : resourceType.key === 'kap' ? 'karma' : 'economy';
    const embed = createEmbed(theme).setTitle(titles[action] || `${resourceType.emoji} ${resourceType.label}`);

    if (action === 'show') {
        embed.setDescription(`**${playerName}**`).addFields({
            name: resourceType.label,
            value: `${bar} **${percentage}%** (${newValue}/${maxValue})`,
        });
    } else {
        const diff = newValue - oldValue;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

        embed.setDescription(`**${playerName}** — ${diffStr} ${resourceType.label}`).addFields(
            { name: 'Previous', value: `${oldValue}/${maxValue}`, inline: true },
            { name: 'Current', value: `${newValue}/${maxValue}`, inline: true },
            {
                name: resourceType.label,
                value: `${bar} **${percentage}%**`,
            }
        );
    }

    return embed;
}

module.exports = {
    createResourceBar,
    createResourceEmbed,
};
