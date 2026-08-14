const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { db } = require('../db');
const { eq, and } = require('drizzle-orm');
const { players, stats: statsTable } = require('../db/schema');
const { readAvatar } = require('../utils/avatarStorage');
const { rollDice } = require('../utils/rollUtil');
const { createLogger } = require('../utils/logger');
const log = createLogger('evade');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('evade')
        .setDescription('Attempt to dodge an attack using your Ausweichen skill'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const discordId = interaction.user.id;

            const [player] = await db
                .select({ id: players.id, name: players.name, avatar: players.avatar })
                .from(players)
                .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')))
                .limit(1);

            if (!player) {
                return interaction.editReply({
                    content: '❌ No character selected! Use `/character select` first.',
                });
            }

            const [stats] = await db
                .select({ ausweichen: statsTable.ausweichen })
                .from(statsTable)
                .where(eq(statsTable.player_id, player.id))
                .limit(1);

            if (!stats) {
                return interaction.editReply({
                    content: '❌ No character selected! Use `/character select` first.',
                });
            }

            const { ausweichen } = stats;
            const diceRoll = rollDice(20);
            const success = diceRoll <= ausweichen;

            const successIndicator = success ? '🟢 SUCCESS' : '🔴 FAILURE';
            const diceComparison = `${diceRoll}${success ? ' ≤ ' : ' > '}${ausweichen}`;
            const successChance = `${Math.round((ausweichen / 20) * 100)}% evasion chance`;

            const embed = new EmbedBuilder()
                .setColor(success ? 0x57f287 : 0xed4245)
                .setTitle(`🛡️ Evasion Attempt - ${successIndicator}`)
                .setDescription(
                    [
                        `**${player.name}** rolled a D20 to evade!`,
                        '',
                        `🎲 **Roll:** \`${diceComparison}\``,
                        `📊 **Base Chance:** \`${successChance}\``,
                    ].join('\n')
                )
                .addFields({
                    name: 'Details',
                    value: [
                        `✦ **Ausweichen:** \`${ausweichen}\``,
                        `✦ **Dice Result:** \`${diceRoll}\``,
                        `✦ **Outcome:** ${success ? '**Evaded!**' : '**Hit!**'}`,
                    ].join('\n'),
                    inline: true,
                })
                .setFooter({
                    text: `Requested by ${interaction.user.username}`,
                    iconURL: interaction.user.avatarURL(),
                })
                .setTimestamp();

            const files = [];
            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);

                    if (avatarBuffer) {
                        files.push(new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' }));
                        embed.setThumbnail('attachment://avatar.png');
                    }
                } catch (e) {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.editReply({
                embeds: [embed],
                files: files,
            });
        } catch (error) {
            log.error({ error }, 'Evade command error');
            return interaction.editReply({
                content: '❌ Failed to process evasion attempt!',
            });
        }
    },
};
