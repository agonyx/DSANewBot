const { SlashCommandBuilder } = require('discord.js');
const { rollDice } = require('../utils/rollUtil');
const { rollNotation } = require('../utils/diceUtils');
const { formatInlineRollResult } = require('../utils/inlineRolls');
const { createEmbed, makeFooter } = require('../utils/embedUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll dice using DSA notation (e.g., 1w20, 3w6+2)')
        .addStringOption(option =>
            option.setName('dice').setDescription('Dice notation (e.g., 1w20, 2w6+3, w6)').setRequired(true)
        )
        .addBooleanOption(option => option.setName('visible').setDescription('Make the roll visible to everyone'))
        .addBooleanOption(option =>
            option.setName('animated').setDescription('Publish the roll to a configured Foundry Dice So Nice webhook')
        ),

    async execute(interaction) {
        const notation = interaction.options.getString('dice');
        const visible = interaction.options.getBoolean('visible') || false;
        const animated = interaction.options.getBoolean('animated') || false;

        if (animated && !interaction.guildId) {
            return interaction.reply({
                content: '❌ Animated rolls require a server with a configured Dice So Nice webhook.',
                ephemeral: true,
            });
        }
        if (animated) await interaction.deferReply({ ephemeral: !visible });

        const result = rollNotation(notation, rollDice);

        if (!result) {
            const response = {
                content: '❌ Invalid dice notation! Use format like `1w20`, `3w6+2`, or `w6`.',
                ...(animated ? {} : { ephemeral: true }),
            };
            return animated ? interaction.editReply(response) : interaction.reply(response);
        }

        let animationStatus = '';
        if (animated) {
            const { dispatchWebhookEvent } = require('../services/webhooks');
            const delivery = await dispatchWebhookEvent(interaction.guildId, 'dice.roll', {
                integration: 'foundry-dice-so-nice',
                formula: result.notation.replaceAll('w', 'd'),
                notation: result.notation,
                rolls: result.rolls,
                modifier: result.modifier,
                total: result.total,
                userId: interaction.user.id,
                dsnData: {
                    throws: [
                        {
                            dice: result.rolls.map(value => ({
                                result: value,
                                resultLabel: value,
                                type: `d${result.sides}`,
                                vectors: [],
                                options: {},
                            })),
                        },
                    ],
                },
            });
            animationStatus = `\n\n🔗 Dice So Nice: ${delivery.delivered} delivered, ${delivery.failed} failed.`;
        }

        const embed = createEmbed('info')
            .setTitle(`🎲 Dice Roll: ${result.notation.toUpperCase()}`)
            .setDescription(`${formatInlineRollResult(result)}${animationStatus}`)
            .setFooter(makeFooter(interaction.user, 'Rolled by'))
            .setTimestamp();

        const response = {
            embeds: [embed],
            ...(animated ? {} : { ephemeral: !visible }),
        };
        return animated ? interaction.editReply(response) : interaction.reply(response);
    },
};
