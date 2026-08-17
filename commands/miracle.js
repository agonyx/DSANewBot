const { SlashCommandBuilder } = require('discord.js');
const { invokeMiracle } = require('../services/supernatural');
const { listSkills } = require('../services/talents');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');

const log = createLogger('miracle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('miracle')
        .setDescription('Spend 4 KaP for +2 on a favored talent, AT, or PA')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('Miracle application')
                .setRequired(true)
                .addChoices(
                    { name: 'Favored talent probe', value: 'TALENT' },
                    { name: 'Next attack', value: 'AT' },
                    { name: 'Next parry', value: 'PA' }
                )
        )
        .addIntegerOption(option => option.setName('talent').setDescription('Favored talent').setAutocomplete(true))
        .addStringOption(option =>
            option.setName('combatant').setDescription('Your active combatant').setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            if (focused.name === 'talent') {
                const rows = await listSkills({ discordId: interaction.user.id });
                return interaction.respond(
                    rows
                        .filter(row => row.talent_name.toLowerCase().includes(String(focused.value).toLowerCase()))
                        .slice(0, 25)
                        .map(row => ({ name: row.talent_name, value: row.talent_id }))
                );
            }
            const session = interaction.client.activeCombats?.get(interaction.channelId);
            return interaction.respond(
                (session?.combatants || [])
                    .filter(
                        combatant =>
                            combatant.discordUserId === interaction.user.id &&
                            combatant.name.toLowerCase().includes(String(focused.value).toLowerCase())
                    )
                    .slice(0, 25)
                    .map(combatant => ({ name: combatant.name, value: combatant.id }))
            );
        } catch (error) {
            log.error({ error }, 'Miracle autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const mode = interaction.options.getString('mode');
        try {
            const result = await invokeMiracle(
                { discordId: interaction.user.id },
                {
                    mode,
                    talentId: interaction.options.getInteger('talent') ?? undefined,
                    combatantId: interaction.options.getString('combatant') ?? undefined,
                }
            );
            const embed = createEmbed('karma')
                .setTitle(`🙏 Miracle of ${result.deity}`)
                .setDescription(
                    mode === 'TALENT'
                        ? `Talent **${result.talent}**: ${result.success ? `success (QS ${result.qs})` : 'failure'}.`
                        : `+2 ${mode} is stored for the next applicable combat roll.`
                )
                .setFooter({ text: `4 KaP spent • ${result.kapAfter} remaining` });
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error, mode }, 'Miracle failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
