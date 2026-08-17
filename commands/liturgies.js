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
const { buildListEmbeds } = require('../utils/embedUtils');
const {
    buildAbilityComponentPayload,
    buildNoticeComponentPayload,
    deferForComponents,
    editDeferredComponents,
} = require('../utils/componentViews');
const { addVisibilityOption, interactionVisibility } = require('../utils/interactionVisibility');

const log = createLogger('liturgies');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liturgies')
        .setDescription('Browse, learn, and perform liturgies or ceremonies')
        .addSubcommand(sub =>
            addVisibilityOption(
                sub
                    .setName('list')
                    .setDescription('List the liturgy catalog')
                    .addStringOption(option => option.setName('search').setDescription('Name search'))
            )
        )
        .addSubcommand(sub =>
            addVisibilityOption(
                sub
                    .setName('show')
                    .setDescription('Show one liturgy or ceremony')
                    .addStringOption(option =>
                        option.setName('liturgy').setDescription('Liturgy').setRequired(true).setAutocomplete(true)
                    )
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
            addVisibilityOption(
                sub
                    .setName('perform')
                    .setDescription('Perform a learned liturgy or begin a ceremony')
                    .addStringOption(option =>
                        option
                            .setName('liturgy')
                            .setDescription('Learned liturgy')
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addIntegerOption(option =>
                        option.setName('modifier').setDescription('Probe modifier').setMinValue(-20).setMaxValue(20)
                    )
                    .addIntegerOption(option =>
                        option
                            .setName('resource_amount')
                            .setDescription('KaP for variable-cost liturgies')
                            .setMinValue(1)
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
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        const publicEligible = ['list', 'show', 'perform'].includes(subcommand);
        const visibility = publicEligible ? interactionVisibility(interaction) : { ephemeral: true };
        const usesComponents = ['show', 'perform'].includes(subcommand);
        if (usesComponents) await deferForComponents(interaction, visibility);
        else await interaction.deferReply({ ephemeral: visibility.ephemeral });
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
                return editDeferredComponents(
                    interaction,
                    buildAbilityComponentPayload(
                        { ...(await getLiturgy(ctx, liturgyId)), abilityType: 'LITURGY' },
                        null,
                        visibility
                    )
                );
            }
            if (subcommand === 'learn') {
                const result = await learnLiturgy(ctx, { liturgyId });
                return interaction.editReply(
                    `✅ Learned **${result.liturgy.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
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
            return editDeferredComponents(
                interaction,
                buildAbilityComponentPayload(
                    { ...result.ability, abilityType: 'LITURGY' },
                    {
                        success: result.success,
                        qualityLevel: result.qualityLevel,
                        paidCost: result.paidCost,
                        resourceAfter: result.resourceAfter,
                        statusText: `The rite ${status}.`,
                    },
                    visibility
                )
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Liturgy command failed');
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
