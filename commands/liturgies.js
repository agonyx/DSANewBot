const { SlashCommandBuilder } = require('discord.js');
const {
    castAbility,
    getLiturgy,
    learnLiturgy,
    listLearnedLiturgies,
    listLiturgyCatalog,
} = require('../services/supernatural');
const { getOrLoadSession, nextTurn } = require('../handlers/combatTurnHandler');
const { createLogger } = require('../utils/logger');
const { buildListEmbeds, createEmbed, truncateText } = require('../utils/embedUtils');

const log = createLogger('liturgies');

function liturgyEmbed(liturgy) {
    const probe =
        [liturgy.probe_attr1, liturgy.probe_attr2, liturgy.probe_attr3].filter(Boolean).join('/') || 'Automatic';
    const embed = createEmbed('karma')
        .setTitle(`🙏 ${liturgy.name}`)
        .setDescription(truncateText(liturgy.description, 3500, 'No description.'))
        .addFields(
            { name: 'Kind', value: liturgy.kind, inline: true },
            { name: 'Probe', value: probe, inline: true },
            {
                name: 'KaP',
                value: `${liturgy.resource_cost}${liturgy.permanent_cost ? ` (${liturgy.permanent_cost} permanent)` : ''}`,
                inline: true,
            },
            { name: 'Casting time', value: liturgy.casting_time || 'Immediate', inline: true },
            { name: 'Duration', value: liturgy.duration || 'Immediate', inline: true },
            { name: 'Range', value: liturgy.range || 'Unspecified', inline: true },
            { name: 'Traditions', value: liturgy.traditions.join(', ') || 'General' },
            { name: 'Aspects', value: liturgy.aspects.join(', ') || 'General', inline: true },
            { name: 'Learning AP', value: String(liturgy.ap_cost), inline: true }
        );
    if (liturgy.source_url) embed.setURL(liturgy.source_url);
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liturgies')
        .setDescription('Browse, learn, and perform liturgies or ceremonies')
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List the liturgy catalog')
                .addStringOption(option => option.setName('search').setDescription('Name search'))
        )
        .addSubcommand(sub =>
            sub
                .setName('show')
                .setDescription('Show one liturgy or ceremony')
                .addStringOption(option =>
                    option.setName('liturgy').setDescription('Liturgy').setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('learn')
                .setDescription('Learn a tradition-compatible liturgy by spending AP')
                .addStringOption(option =>
                    option.setName('liturgy').setDescription('Liturgy').setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('perform')
                .setDescription('Perform a learned liturgy or begin a ceremony')
                .addStringOption(option =>
                    option.setName('liturgy').setDescription('Learned liturgy').setRequired(true).setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('modifier').setDescription('Probe modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('resource_amount').setDescription('KaP for variable-cost liturgies').setMinValue(1)
                )
                .addUserOption(option => option.setName('target').setDescription('Player target (default: self)'))
                .addStringOption(option =>
                    option.setName('combatant').setDescription('Combatant target').setAutocomplete(true)
                )
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            if (focused.name === 'combatant') {
                const session = interaction.client.activeCombats?.get(interaction.channelId);
                return interaction.respond(
                    (session?.combatants || [])
                        .filter(combatant => combatant.name.toLowerCase().includes(String(focused.value).toLowerCase()))
                        .slice(0, 25)
                        .map(combatant => ({ name: combatant.name.slice(0, 100), value: combatant.id }))
                );
            }
            const rows =
                interaction.options.getSubcommand() === 'perform'
                    ? (await listLearnedLiturgies({ discordId: interaction.user.id })).map(row => row.liturgy)
                    : await listLiturgyCatalog(
                          { discordId: interaction.user.id },
                          { search: String(focused.value), limit: 25 }
                      );
            return interaction.respond(
                rows
                    .filter(row => row.name.toLowerCase().includes(String(focused.value).toLowerCase()))
                    .slice(0, 25)
                    .map(row => ({ name: `${row.name} (${row.kind})`.slice(0, 100), value: row.id }))
            );
        } catch (error) {
            log.error({ error }, 'Liturgy autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'list') {
                const rows = await listLiturgyCatalog(ctx, {
                    search: interaction.options.getString('search') || undefined,
                    limit: 25,
                });
                return interaction.editReply({
                    embeds: buildListEmbeds({
                        title: '🙏 Liturgy & Ceremony Catalog',
                        theme: 'karma',
                        description: `**${rows.length} result${rows.length === 1 ? '' : 's'}** · Use \`/liturgies show\` for full rules.`,
                        lines: rows.map(row => `**${row.name}** · ${row.kind} · ${row.resource_cost} KaP`),
                        emptyMessage: 'No matching liturgies.',
                    }),
                });
            }
            const liturgyId = interaction.options.getString('liturgy');
            if (subcommand === 'show') {
                return interaction.editReply({ embeds: [liturgyEmbed(await getLiturgy(ctx, liturgyId))] });
            }
            if (subcommand === 'learn') {
                const result = await learnLiturgy(ctx, { liturgyId });
                return interaction.editReply(
                    `✅ Learned **${result.liturgy.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            const target = interaction.options.getUser('target');
            const combatantId = interaction.options.getString('combatant');
            if (target && combatantId) return interaction.editReply('❌ Choose either a player or combatant target.');
            const result = await castAbility(ctx, {
                abilityType: 'LITURGY',
                abilityId: liturgyId,
                modifier: interaction.options.getInteger('modifier') || 0,
                resourceAmount: interaction.options.getInteger('resource_amount') ?? undefined,
                targetDiscordId: target?.id,
                targetCombatantId: combatantId,
            });
            if (result.combatChannelId) {
                await getOrLoadSession(interaction.client, result.combatChannelId);
                await nextTurn(interaction.client, result.combatChannelId);
            }
            const status = !result.success
                ? 'failed'
                : result.pending
                  ? `began and completes <t:${Math.floor(new Date(result.casting.completes_at).getTime() / 1000)}:R>`
                  : 'succeeded';
            return interaction.editReply(
                `${result.success ? '✅' : '❌'} **${result.ability.name}** ${status}. ` +
                    `QS ${result.qualityLevel}; ${result.paidCost} KaP spent; ${result.resourceAfter} remain.`
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Liturgy command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
