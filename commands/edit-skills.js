const { SlashCommandBuilder } = require('discord.js');
const { getAdvancementOptions, learnSpecialAbility } = require('../services/advancement');
const { createLogger } = require('../utils/logger');

const log = createLogger('edit-skills');

/** Backward-compatible alias for the AP-backed /advance special workflow. */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-skills')
        .setDescription('Learn a special ability by spending AP')
        .addStringOption(option =>
            option.setName('ability').setDescription('Special ability').setRequired(true).setAutocomplete(true)
        )
        .addBooleanOption(option =>
            option
                .setName('prerequisites_confirmed')
                .setDescription('Confirm manually checked source prerequisites when required')
        ),

    async autocomplete(interaction) {
        try {
            const rows = (await getAdvancementOptions({ discordId: interaction.user.id })).specialAbilities;
            const search = String(interaction.options.getFocused()).toLowerCase();
            return interaction.respond(
                rows
                    .filter(row => row.name.toLowerCase().includes(search))
                    .slice(0, 25)
                    .map(row => ({
                        name: `${row.name} (${row.apCost} AP${row.requiresConfirmation ? ', confirm rules' : ''})`.slice(
                            0,
                            100
                        ),
                        value: row.id,
                    }))
            );
        } catch (error) {
            log.error({ error }, 'Special ability autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await learnSpecialAbility(
                { discordId: interaction.user.id },
                {
                    abilityId: interaction.options.getString('ability', true),
                    confirmedPrerequisites: interaction.options.getBoolean('prerequisites_confirmed') ?? false,
                }
            );
            return interaction.editReply(
                `✅ Learned **${result.ability.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
            );
        } catch (error) {
            log.error({ error }, 'Special ability learning failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
