const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getCharacterSheet } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { calculatePainLevel } = require('../utils/conditionUtils');
const {
    calculateEffectivePainLevel,
    calculateWoundPenalty,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} = require('../utils/woundUtils');
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

            const maxLP = stats.le_max || 1;
            const currentLP = stats.le_current;
            const healthPercentage = Math.floor((currentLP / maxLP) * 100);
            const filledHealth = Math.round(Math.max(0, Math.min(1, currentLP / maxLP)) * 10);
            const healthBar = '■'.repeat(filledHealth) + '□'.repeat(10 - filledHealth);
            const woundThreshold = calculateWoundThreshold(stats.ko, stats.wound_threshold_modifier);
            const woundPenalty = calculateWoundPenalty(stats.wounds);
            const painLevel = calculateEffectivePainLevel(
                calculatePainLevel(currentLP, maxLP),
                stats.pain_suppression,
                stats.pain_modifier
            );

            const statsEmbed = new EmbedBuilder()
                .setColor(0x2f3136)
                .setTitle(`🔰 ${player.name}'s Statistics`)
                .setDescription(
                    `**Character Overview**\n${healthBar} **${healthPercentage}%** (${currentLP}/${maxLP} LP)`
                )
                .addFields(
                    {
                        name: '🧠 Attributes',
                        value: [
                            `**MU:** \`${stats.mu}\``,
                            `**KL:** \`${stats.kl}\``,
                            `**IN:** \`${stats.in}\``,
                            `**CH:** \`${stats.ch}\``,
                        ].join('\n'),
                        inline: true,
                    },
                    {
                        name: '⚔️ Combat Stats',
                        value: [
                            `**FF:** \`${stats.ff}\``,
                            `**GE:** \`${stats.ge}\``,
                            `**KO:** \`${stats.ko}\``,
                            `**KK:** \`${stats.kk}\``,
                        ].join('\n'),
                        inline: true,
                    },
                    {
                        name: '🛡️ Defense',
                        value: [
                            `**Initiative:** \`${stats.initiative}\``,
                            `**Ausweichen:** \`${stats.ausweichen}\``,
                            `**Armor RS:** \`${stats.ruestungsschutz}\` (natural ${stats.natural_armor})`,
                            `**Belastung:** \`${stats.belastung}\``,
                            `**Max LP:** \`${stats.le_max}\``,
                            `**Current LP:** \`${stats.le_current}\``,
                            `**Wounds:** \`${stats.wounds}\``,
                            `**Wound Threshold:** \`${woundThreshold || '—'}\``,
                            `**Wound Penalty:** \`-${woundPenalty}\``,
                            `**Pain:** \`${painLevel}\``,
                            `**Capable:** \`${isIncapacitatedByWounds(stats.wounds) ? 'No' : 'Yes'}\``,
                        ].join('\n'),
                        inline: true,
                    }
                );

            // Build resource lines
            const resourceLines = [];

            // Schicksalspunkte (always)
            const schipsBar =
                '■'.repeat(Math.round((stats.schicksalspunkte_current / Math.max(1, stats.schicksalspunkte_max)) * 5)) +
                '□'.repeat(
                    5 - Math.round((stats.schicksalspunkte_current / Math.max(1, stats.schicksalspunkte_max)) * 5)
                );
            resourceLines.push(
                `🎲 **SchP:** ${schipsBar} ${stats.schicksalspunkte_current}/${stats.schicksalspunkte_max}`
            );
            resourceLines.push(
                `⭐ **AP:** ${stats.ap_available} available / ${stats.ap_spent} spent / ${stats.ap_total} total`
            );

            // AsP (only if spellcaster)
            if (stats.asp_max > 0) {
                const aspBar =
                    '■'.repeat(Math.round((stats.asp_current / stats.asp_max) * 10)) +
                    '□'.repeat(10 - Math.round((stats.asp_current / stats.asp_max) * 10));
                resourceLines.push(`✨ **AsP:** ${aspBar} ${stats.asp_current}/${stats.asp_max}`);
            }

            // KaP (only if blessed)
            if (stats.kap_max > 0) {
                const kapBar =
                    '■'.repeat(Math.round((stats.kap_current / stats.kap_max) * 10)) +
                    '□'.repeat(10 - Math.round((stats.kap_current / stats.kap_max) * 10));
                resourceLines.push(`🙏 **KaP:** ${kapBar} ${stats.kap_current}/${stats.kap_max}`);
            }

            statsEmbed
                .addFields({
                    name: '📊 Resources',
                    value: resourceLines.join('\n'),
                    inline: false,
                })
                .setFooter({
                    text: `Requested by ${interaction.user.username}`,
                    iconURL: interaction.user.avatarURL(),
                });

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
