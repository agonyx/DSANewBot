const { SlashCommandBuilder } = require('discord.js');
const { rollDice } = require('../utils/rollUtil');
const { rollNotation } = require('../utils/diceUtils');
const { formatInlineRollResult } = require('../utils/inlineRolls');
const { deleteDiceMacro, getDiceMacro, listDiceMacros, saveDiceMacro } = require('../services/diceMacros');
const { createLogger } = require('../utils/logger');
const { createEmbed, makeFooter } = require('../utils/embedUtils');

const log = createLogger('macro');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('macro')
        .setDescription('Save and roll reusable dice expressions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('save')
                .setDescription('Save or update a dice macro')
                .addStringOption(option =>
                    option.setName('name').setDescription('Letters, numbers, _ or -').setMaxLength(32).setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('dice').setDescription('Dice notation, e.g. 2w6+3').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('roll')
                .setDescription('Roll a saved macro')
                .addStringOption(option =>
                    option.setName('name').setDescription('Saved macro').setAutocomplete(true).setRequired(true)
                )
                .addBooleanOption(option =>
                    option.setName('visible').setDescription('Make the roll visible to everyone')
                )
        )
        .addSubcommand(subcommand => subcommand.setName('list').setDescription('List saved dice macros'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a saved dice macro')
                .addStringOption(option =>
                    option.setName('name').setDescription('Saved macro').setAutocomplete(true).setRequired(true)
                )
        ),

    async autocomplete(interaction) {
        try {
            const query = interaction.options.getFocused().toLowerCase();
            const macros = await listDiceMacros({ discordId: interaction.user.id });
            return interaction.respond(
                macros
                    .filter(macro => macro.name.includes(query))
                    .slice(0, 25)
                    .map(macro => ({ name: `${macro.name} (${macro.notation})`.slice(0, 100), value: macro.name }))
            );
        } catch (error) {
            log.error({ error }, 'Macro autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const visible = subcommand === 'roll' && (interaction.options.getBoolean('visible') || false);
        await interaction.deferReply({ ephemeral: !visible });
        const ctx = { discordId: interaction.user.id };
        try {
            if (subcommand === 'save') {
                const result = await saveDiceMacro(ctx, {
                    name: interaction.options.getString('name', true),
                    notation: interaction.options.getString('dice', true),
                });
                return interaction.editReply(
                    `✅ ${result.created ? 'Saved' : 'Updated'} **${result.macro.name}** → \`${result.macro.notation}\`.`
                );
            }
            if (subcommand === 'list') {
                const macros = await listDiceMacros(ctx);
                const shown = macros.slice(0, 25);
                const remainder = macros.length - shown.length;
                return interaction.editReply(
                    macros.length
                        ? `🎲 **Saved macros**\n${shown.map(macro => `• **${macro.name}** → \`${macro.notation}\``).join('\n')}${remainder ? `\n…and ${remainder} more.` : ''}`
                        : 'No dice macros saved. Use `/macro save` to create one.'
                );
            }
            const name = interaction.options.getString('name', true);
            if (subcommand === 'delete') {
                const result = await deleteDiceMacro(ctx, name);
                return interaction.editReply(`🗑️ Deleted dice macro **${result.macro.name}**.`);
            }

            const result = await getDiceMacro(ctx, name);
            const roll = rollNotation(result.macro.notation, rollDice);
            if (!roll) throw new Error('Saved macro has invalid dice notation');
            const embed = createEmbed('info')
                .setTitle(`🎲 ${result.macro.name}: ${roll.notation.toUpperCase()}`)
                .setDescription(formatInlineRollResult(roll))
                .setFooter(makeFooter(interaction.user, 'Rolled by'))
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error, subcommand }, 'Macro command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
