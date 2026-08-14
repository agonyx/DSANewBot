const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { healCharacter } = require('../services/resources');
const { createLogger } = require('../utils/logger');
const log = createLogger('heal');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('heal')
        .setDescription('Manually restore LeP to your character or another character (DM only for others)')
        .addIntegerOption(option =>
            option.setName('amount').setDescription('Amount of LeP to restore').setRequired(true).setMinValue(1)
        )
        .addUserOption(option =>
            option.setName('target').setDescription('Target character to heal (optional, defaults to yourself)')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('target');
        const isSelf = !targetUser || targetUser.id === interaction.user.id;
        const ctx = { discordId: interaction.user.id };

        try {
            const { characterName, oldValue, newValue, actualHeal, max } = await healCharacter(ctx, {
                amount,
                targetDiscordId: targetUser?.id,
            });

            if (actualHeal === 0) {
                return interaction.editReply({
                    content: `**${characterName}** is already at full health! (${oldValue}/${max} HP)`,
                });
            }

            const healthBar =
                '■'.repeat(Math.round((newValue / max) * 10)) + '□'.repeat(10 - Math.round((newValue / max) * 10));
            const healthPercentage = Math.round((newValue / max) * 100);

            const embed = new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle('💚 Healing Applied')
                .setDescription(`**${characterName}** has been healed!`)
                .addFields(
                    { name: 'Healing', value: `+${actualHeal} HP`, inline: true },
                    { name: 'Previous HP', value: `${oldValue}/${max}`, inline: true },
                    { name: 'Current HP', value: `${newValue}/${max}`, inline: true }
                )
                .addFields({ name: 'Health Bar', value: `${healthBar} **${healthPercentage}%**` })
                .setFooter({ text: `Healed by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            if (error.status === 404) {
                return interaction.editReply({
                    content: isSelf
                        ? '❌ No character selected! Use `/character select` first.'
                        : '❌ Target has no selected character.',
                });
            }
            if (error.status === 400) {
                return interaction.editReply({ content: `❌ ${error.data?.error || error.message}` });
            }
            log.error({ error }, 'Heal command error');
            return interaction.editReply({ content: `❌ An error occurred: ${error.message}` });
        }
    },
};
