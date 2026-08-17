const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { listCharacters } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const log = createLogger('choose-character');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('choose-character')
        .setDescription('Choose a character from your available characters.'),
    async execute(interaction) {
        const discordId = interaction.user.id;

        try {
            const playerRows = await listCharacters({ discordId });

            if (!playerRows || playerRows.length === 0) {
                return interaction.reply({
                    content: 'You do not have any characters to choose from.',
                    ephemeral: true,
                });
            }

            const options = playerRows.map(player => ({
                label: player.name + (player.selected === 'YES' ? ' (Selected)' : ''),
                value: player.id.toString(),
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-character')
                .setPlaceholder('Choose your character')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const message = await interaction.reply({
                content: 'Please choose your character:',
                components: [row],
                ephemeral: true,
                fetchReply: true,
            });

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 60000,
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    interaction
                        .editReply({ content: '⏰ Character selection timed out.', components: [] })
                        .catch(() => {});
                }
            });
        } catch (error) {
            log.error({ error }, 'Error fetching characters');
            return interaction.reply({
                content: 'An error occurred while fetching your characters. Please try again later.',
                ephemeral: true,
            });
        }
    },
};
