const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listLearnedSpecialAbilities } = require('../services/advancement');
const { createLogger } = require('../utils/logger');

const log = createLogger('show-skills');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-skills')
        .setDescription('Displays the special abilities of your selected character.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await listLearnedSpecialAbilities({ discordId: interaction.user.id });
            const rows = [...result.combatAbilities, ...result.catalogAbilities];
            const description = rows
                .map(
                    ability =>
                        `**${ability.name}** (${ability.category || 'SPECIAL'}, ${ability.apCost} AP): ${ability.description || 'No description'}`
                )
                .join('\n');
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`Special Abilities for ${result.characterName}`)
                .setDescription(
                    (description || 'This character has not learned any special abilities yet.').slice(0, 4096)
                );
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Error in /show-skills');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
