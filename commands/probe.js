const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { resolveProbe, listSkills } = require('../services/talents');
const { createLogger } = require('../utils/logger');

const log = createLogger('probe');

const STAT_DISPLAY_NAMES = {
    MU: 'Mut',
    KL: 'Klugheit',
    IN: 'Intuition',
    CH: 'Charisma',
    FF: 'Fingerfertigkeit',
    GE: 'Gewandtheit',
    KO: 'Konstitution',
    KK: 'Körperkraft',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('probe')
        .setDescription('Perform a talent probe (Talentprobe)')
        .addStringOption(option =>
            option.setName('talent').setDescription('The talent to probe').setRequired(true).setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option.setName('modifier').setDescription('Modifier to apply to FtW (e.g., -2 for difficult, +3 for easy)')
        )
        .addBooleanOption(option => option.setName('visible').setDescription('Make the roll visible to everyone')),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        try {
            const skills = await listSkills({ discordId: interaction.user.id });
            const choices = skills.map(s => ({
                name: `${s.talent_name} (FtW: ${s.ftw})`,
                value: s.talent_id.toString(),
            }));
            const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue.toLowerCase()));
            await interaction.respond(filtered.slice(0, 25));
        } catch (error) {
            if (error.code === 40060) return; // interaction already acknowledged/expired
            log.error({ error }, 'Autocomplete error');
            try {
                await interaction.respond([]);
            } catch {
                // Ignore - interaction may have expired
            }
        }
    },

    async execute(interaction) {
        const talentId = parseInt(interaction.options.getString('talent'), 10);
        const modifier = interaction.options.getInteger('modifier') || 0;
        const visible = interaction.options.getBoolean('visible') || false;

        try {
            const result = await resolveProbe({ discordId: interaction.user.id }, { talentId, modifier });
            return interaction.reply({ embeds: [buildProbeEmbed(result, interaction.user)], ephemeral: !visible });
        } catch (error) {
            if (error.status === 404) {
                return interaction.reply({
                    content: `❌ ${error.data?.error || error.message}`,
                    ephemeral: true,
                });
            }
            log.error({ error }, 'Probe command error');
            return interaction.reply({
                content: '❌ Failed to perform talent probe!',
                ephemeral: true,
            });
        }
    },
};

/** Pure renderer: turns a ProbeResult into the Discord embed (presentation only). */
function buildProbeEmbed(result, user) {
    const {
        characterName,
        talent,
        baseFtw,
        modifier,
        woundPenalty,
        conditionModifier,
        checkResults,
        remainingFtw,
        success,
        qs,
    } = result;

    return new EmbedBuilder()
        .setColor(success ? 0x00ff00 : 0xff4444)
        .setTitle(`🎯 ${talent.name}`)
        .setDescription(success ? `**Erfolg!** QS ${qs}` : '**Fehlschlag!**')
        .addFields(
            {
                name: 'Proben',
                value: checkResults
                    .map(
                        r =>
                            `${STAT_DISPLAY_NAMES[r.attrCode] || r.attrCode}: \`${r.roll}\`/\`${r.attrValue}\`${
                                r.needed > 0 ? ` (−${r.needed})` : ' ✓'
                            }`
                    )
                    .join('\n'),
                inline: false,
            },
            {
                name: 'FtW',
                value: `\`${baseFtw}\`${modifier !== 0 ? ` (${modifier >= 0 ? '+' : ''}${modifier})` : ''}`,
                inline: true,
            },
            {
                name: 'Übrig',
                value: `\`${remainingFtw}\``,
                inline: true,
            },
            {
                name: 'QS',
                value: `\`${qs}\``,
                inline: true,
            },
            ...(woundPenalty > 0
                ? [{ name: 'Wundabzug', value: `\`-${woundPenalty}\` auf jede Eigenschaft`, inline: true }]
                : []),
            ...(conditionModifier !== 0
                ? [
                      {
                          name: 'Kampfzustände',
                          value: `\`${conditionModifier > 0 ? '+' : ''}${conditionModifier}\` auf jede Eigenschaft`,
                          inline: true,
                      },
                  ]
                : [])
        )
        .setFooter({
            text: `${characterName} • ${user.username}`,
            iconURL: user.avatarURL(),
        })
        .setTimestamp();
}
