const { SlashCommandBuilder } = require('discord.js');
const { regenerate } = require('../services/resources');
const { createLogger } = require('../utils/logger');
const { createEmbed, makeFooter, progressBar } = require('../utils/embedUtils');
const log = createLogger('regeneration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('regeneration')
        .setDescription('Perform a Regenerationsphase — roll 1W6 for each energy type to recover points after rest')
        .addUserOption(option =>
            option.setName('target').setDescription('Target character (optional, defaults to yourself)')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('target');
        const isSelf = !targetUser || targetUser.id === interaction.user.id;
        const ctx = { discordId: interaction.user.id };

        try {
            const {
                characterName,
                alreadyFull,
                results,
                woundsBefore,
                woundsHealed,
                woundsAfter,
                painSuppressionExpired,
                recoveredConditions,
                regenerationPenalty,
            } = await regenerate(ctx, {
                targetDiscordId: targetUser?.id,
            });

            if (alreadyFull) {
                return interaction.editReply({
                    content: `ℹ️ **${characterName}** is already fully rested! All resources are at maximum.`,
                });
            }

            const embed = createEmbed('success')
                .setTitle(`🌙 Regenerationsphase — ${characterName}`)
                .setDescription(`After a period of rest, **${characterName}** recovers energy.`)
                .setFooter(makeFooter(interaction.user, 'Regeneration by'))
                .setTimestamp();

            for (const r of results) {
                const resourceBar = progressBar(r.newValue, r.maxValue);
                const modifierDisplay =
                    r.modifier !== 0 ? ` (${r.modifier >= 0 ? '+' : ''}${r.modifier} = ${r.effective})` : '';

                embed.addFields({
                    name: `${r.emoji} ${r.label}`,
                    value: `🎲 Roll: **${r.roll}**${modifierDisplay}\n${r.oldValue} → **${r.newValue}** / ${r.maxValue}\n${resourceBar}`,
                });
            }

            if (woundsHealed > 0) {
                embed.addFields({
                    name: '🩸 Natural wound healing',
                    value: `${woundsBefore} → **${woundsAfter}** wound(s)`,
                });
            }
            if (painSuppressionExpired) {
                embed.addFields({ name: '⚡ Pain treatment', value: 'Temporary pain suppression has ended.' });
            }
            if (recoveredConditions.length > 0) {
                embed.addFields({ name: '✅ Rest recovery', value: recoveredConditions.join(', ') });
            }
            if (regenerationPenalty < 0) {
                embed.addFields({
                    name: '🥱 Exhaustion',
                    value: `${regenerationPenalty} to LeP, AsP, and KaP regeneration rolls.`,
                });
            }

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            if (error.status === 404) {
                return interaction.editReply({
                    content: isSelf
                        ? '❌ No character selected! Use `/character select` first.'
                        : '❌ Target has no selected character.',
                });
            }
            log.error({ error }, 'Regeneration command error');
            return interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
