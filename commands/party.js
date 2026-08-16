const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { joinParty, leaveParty, listParty } = require('../services/party');
const { buildPartyOverviewEmbeds } = require('../utils/embedViews');
const { createLogger } = require('../utils/logger');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');

const log = createLogger('party');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('party')
        .setDescription('Join this server party or view its selected characters')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand.setName('join').setDescription('Enroll your selected character in this server party')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('leave').setDescription('Remove yourself from this server party')
        )
        .addSubcommand(subcommand =>
            addVisibilityOption(
                subcommand.setName('view').setDescription('Show the DM overview of enrolled characters')
            )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        if (!guildId) {
            return interaction.reply({ content: '❌ Party commands can only be used in a server.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'view' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ Party overview requires Manage Server permission.',
                ephemeral: true,
            });
        }

        if (subcommand === 'view') await deferWithVisibility(interaction);
        else await interaction.deferReply({ ephemeral: true });
        try {
            const ctx = { discordId: interaction.user.id };
            if (subcommand === 'join') {
                const result = await joinParty(ctx, guildId);
                return interaction.editReply(
                    `✅ **${result.characterName}** joined this server party. Re-run \`/party join\` after switching characters to update the slot.`
                );
            }
            if (subcommand === 'leave') {
                await leaveParty(ctx, guildId);
                return interaction.editReply('✅ You left this server party.');
            }

            const party = await listParty({ ...ctx, role: 'DM' }, guildId);
            return interaction.editReply({ embeds: buildPartyOverviewEmbeds(party, interaction.user) });
        } catch (error) {
            log.error({ error, guildId, subcommand }, 'Party command failed');
            const knownMessage =
                error.status === 404 && subcommand === 'join'
                    ? 'No character selected. Use `/character select` first.'
                    : error.status
                      ? error.message
                      : null;
            const message = knownMessage || 'Failed to update or load the party overview.';
            return interaction.editReply(`❌ ${message}`);
        }
    },
};
