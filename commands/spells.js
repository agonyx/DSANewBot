const { SlashCommandBuilder } = require('discord.js');
const { castAbility, getSpell, learnSpell, listLearnedSpells, listSpellCatalog } = require('../services/supernatural');
const { getOrLoadSession, nextTurn } = require('../handlers/combatTurnHandler');
const { createLogger } = require('../utils/logger');
const { buildListEmbeds } = require('../utils/embedUtils');
const {
    buildAbilityComponentPayload,
    buildNoticeComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
const { addVisibilityOption, interactionVisibility } = require('../utils/interactionVisibility');

const log = createLogger('spells');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spells')
        .setDescription('Browse, learn, and cast spells or rituals')
        .addSubcommand(sub =>
            addVisibilityOption(
                sub
                    .setName('list')
                    .setDescription('List the spell catalog')
                    .addStringOption(option => option.setName('search').setDescription('Name search'))
            )
        )
        .addSubcommand(sub =>
            addVisibilityOption(
                sub
                    .setName('show')
                    .setDescription('Show one spell or ritual')
                    .addStringOption(option =>
                        option.setName('spell').setDescription('Spell').setRequired(true).setAutocomplete(true)
                    )
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
            addVisibilityOption(
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
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        const publicEligible = ['list', 'show', 'cast'].includes(subcommand);
        const visibility = publicEligible ? interactionVisibility(interaction) : { ephemeral: true };
        const usesComponents = ['show', 'cast'].includes(subcommand);
        if (usesComponents) await deferForComponents(interaction, visibility);
        else await interaction.deferReply({ ephemeral: visibility.ephemeral });
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
                return editDeferredComponents(
                    interaction,
                    buildAbilityComponentPayload(
                        { ...(await getSpell(ctx, spellId)), abilityType: 'SPELL' },
                        null,
                        visibility
                    )
                );
            if (subcommand === 'learn') {
                const result = await learnSpell(ctx, { spellId });
                return interaction.editReply(
                    `✅ Learned **${result.spell.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            const target = interaction.options.getUser('target');
            const combatantId = interaction.options.getString('combatant');
            if (target && combatantId)
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload('❌ Choose either a player or combatant target.', { theme: 'error' })
                );
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
            return editDeferredComponents(
                interaction,
                buildAbilityComponentPayload(
                    { ...result.ability, abilityType: 'SPELL' },
                    {
                        success: result.success,
                        qualityLevel: result.qualityLevel,
                        paidCost: result.paidCost,
                        resourceAfter: result.resourceAfter,
                        statusText: `The casting ${status}.`,
                    },
                    visibility
                )
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Spell command failed');
            if (usesComponents) {
                return editDeferredComponents(
                    interaction,
                    buildNoticeComponentPayload(`❌ ${error.data?.error || error.message}`, { theme: 'error' })
                );
            }
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
