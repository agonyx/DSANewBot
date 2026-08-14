const { SlashCommandBuilder } = require('discord.js');
const { castAbility, getSpell, learnSpell, listLearnedSpells, listSpellCatalog } = require('../services/supernatural');
const { getOrLoadSession, nextTurn } = require('../handlers/combatTurnHandler');
const { createLogger } = require('../utils/logger');
const { buildListEmbeds, createEmbed, truncateText } = require('../utils/embedUtils');

const log = createLogger('spells');

function spellEmbed(spell) {
    const probe = [spell.probe_attr1, spell.probe_attr2, spell.probe_attr3].filter(Boolean).join('/') || 'Automatic';
    const embed = createEmbed('magic')
        .setTitle(`✨ ${spell.name}`)
        .setDescription(truncateText(spell.description, 3500, 'No description.'))
        .addFields(
            { name: 'Kind', value: spell.kind, inline: true },
            { name: 'Probe', value: probe, inline: true },
            {
                name: 'AsP',
                value: `${spell.resource_cost}${spell.permanent_cost ? ` (${spell.permanent_cost} permanent)` : ''}`,
                inline: true,
            },
            { name: 'Casting time', value: spell.casting_time || 'Immediate', inline: true },
            { name: 'Duration', value: spell.duration || 'Immediate', inline: true },
            { name: 'Range', value: spell.range || 'Unspecified', inline: true },
            { name: 'Traditions', value: spell.traditions.join(', ') || 'General' },
            { name: 'Effect', value: spell.effect_type, inline: true },
            { name: 'Learning AP', value: String(spell.ap_cost), inline: true }
        );
    if (spell.source_url) embed.setURL(spell.source_url);
    return embed;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spells')
        .setDescription('Browse, learn, and cast spells or rituals')
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List the spell catalog')
                .addStringOption(option => option.setName('search').setDescription('Name search'))
        )
        .addSubcommand(sub =>
            sub
                .setName('show')
                .setDescription('Show one spell or ritual')
                .addStringOption(option =>
                    option.setName('spell').setDescription('Spell').setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('learn')
                .setDescription('Learn a tradition-compatible spell by spending AP')
                .addStringOption(option =>
                    option.setName('spell').setDescription('Spell').setRequired(true).setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('cast')
                .setDescription('Cast a learned spell or begin a ritual')
                .addStringOption(option =>
                    option.setName('spell').setDescription('Learned spell').setRequired(true).setAutocomplete(true)
                )
                .addIntegerOption(option =>
                    option.setName('modifier').setDescription('Probe modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('resource_amount').setDescription('AsP for variable-cost spells').setMinValue(1)
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
                const choices = (session?.combatants || [])
                    .filter(combatant => combatant.name.toLowerCase().includes(String(focused.value).toLowerCase()))
                    .slice(0, 25)
                    .map(combatant => ({ name: combatant.name.slice(0, 100), value: combatant.id }));
                return interaction.respond(choices);
            }
            const subcommand = interaction.options.getSubcommand();
            const rows =
                subcommand === 'cast'
                    ? (await listLearnedSpells({ discordId: interaction.user.id })).map(row => row.spell)
                    : await listSpellCatalog(
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
            log.error({ error }, 'Spell autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'list') {
                const rows = await listSpellCatalog(ctx, {
                    search: interaction.options.getString('search') || undefined,
                    limit: 25,
                });
                return interaction.editReply({
                    embeds: buildListEmbeds({
                        title: '✨ Spell & Ritual Catalog',
                        theme: 'magic',
                        description: `**${rows.length} result${rows.length === 1 ? '' : 's'}** · Use \`/spells show\` for full rules.`,
                        lines: rows.map(row => `**${row.name}** · ${row.kind} · ${row.resource_cost} AsP`),
                        emptyMessage: 'No matching spells.',
                    }),
                });
            }
            const spellId = interaction.options.getString('spell');
            if (subcommand === 'show')
                return interaction.editReply({ embeds: [spellEmbed(await getSpell(ctx, spellId))] });
            if (subcommand === 'learn') {
                const result = await learnSpell(ctx, { spellId });
                return interaction.editReply(
                    `✅ Learned **${result.spell.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            const target = interaction.options.getUser('target');
            const combatantId = interaction.options.getString('combatant');
            if (target && combatantId) return interaction.editReply('❌ Choose either a player or combatant target.');
            const result = await castAbility(ctx, {
                abilityType: 'SPELL',
                abilityId: spellId,
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
                    `QS ${result.qualityLevel}; ${result.paidCost} AsP spent; ${result.resourceAfter} remain.`
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Spell command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
