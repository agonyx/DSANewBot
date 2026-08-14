const { SlashCommandBuilder } = require('discord.js');
const { getSupernaturalProfile, setSupernaturalProfile } = require('../services/supernatural');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');

const log = createLogger('tradition');

function profileEmbed(profile) {
    return createEmbed('magic')
        .setTitle(`🔮 Traditions — ${profile.characterName || 'Selected character'}`)
        .addFields(
            { name: 'Magical tradition', value: profile.magicalTradition || profile.magical_tradition || 'None' },
            { name: 'Blessed tradition', value: profile.blessedTradition || profile.blessed_tradition || 'None' },
            { name: 'Deity', value: profile.deity || 'None' },
            {
                name: 'Favored talents',
                value: (profile.favoredTalents || profile.favored_talents || []).join(', ') || 'None',
            }
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tradition')
        .setDescription('Configure magical and blessed traditions for your selected character')
        .addSubcommand(sub => sub.setName('show').setDescription('Show the current supernatural profile'))
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Set traditions, deity, and miracle-favored talents')
                .addStringOption(option =>
                    option.setName('magical').setDescription('Magical tradition, e.g. Gildenmagier')
                )
                .addStringOption(option => option.setName('blessed').setDescription('Blessed tradition, e.g. Peraine'))
                .addStringOption(option => option.setName('deity').setDescription('Deity or pantheon'))
                .addStringOption(option =>
                    option.setName('favored_talents').setDescription('Comma-separated deity-favored talents')
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            if (interaction.options.getSubcommand() === 'show') {
                return interaction.editReply({
                    embeds: [profileEmbed(await getSupernaturalProfile({ discordId: interaction.user.id }))],
                });
            }
            const current = await getSupernaturalProfile({ discordId: interaction.user.id });
            const favoredInput = interaction.options.getString('favored_talents');
            await setSupernaturalProfile(
                { discordId: interaction.user.id },
                {
                    magicalTradition: interaction.options.getString('magical') ?? current.magicalTradition,
                    blessedTradition: interaction.options.getString('blessed') ?? current.blessedTradition,
                    deity: interaction.options.getString('deity') ?? current.deity,
                    favoredTalents: favoredInput
                        ? favoredInput
                              .split(',')
                              .map(value => value.trim())
                              .filter(Boolean)
                        : current.favoredTalents,
                }
            );
            return interaction.editReply({
                embeds: [profileEmbed(await getSupernaturalProfile({ discordId: interaction.user.id }))],
            });
        } catch (error) {
            log.error({ error }, 'Tradition command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
