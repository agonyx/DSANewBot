const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { rollDice } = require('../utils/rollUtil');
const { formatDiceRollBreakdown, rollNotation } = require('../utils/diceUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll dice using DSA notation (e.g., 1w20, 3w6+2)')
        .addStringOption(option =>
            option.setName('dice').setDescription('Dice notation (e.g., 1w20, 2w6+3, w6)').setRequired(true)
        )
        .addBooleanOption(option => option.setName('visible').setDescription('Make the roll visible to everyone')),

    async execute(interaction) {
        const notation = interaction.options.getString('dice');
        const visible = interaction.options.getBoolean('visible') || false;

        const result = rollNotation(notation, rollDice);

        if (!result) {
            return interaction.reply({
                content: '❌ Invalid dice notation! Use format like `1w20`, `3w6+2`, or `w6`.',
                ephemeral: true,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🎲 Dice Roll: ${result.notation.toUpperCase()}`)
            .setDescription(`**Result:** \`${result.total}\``)
            .addFields({
                name: 'Rolls',
                value: `\`${formatDiceRollBreakdown(result)}\``,
                inline: true,
            })
            .setFooter({
                text: `Rolled by ${interaction.user.username}`,
                iconURL: interaction.user.avatarURL(),
            })
            .setTimestamp();

        return interaction.reply({
            embeds: [embed],
            ephemeral: !visible,
        });
    },
};
