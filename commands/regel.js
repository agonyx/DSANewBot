const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ComponentType,
} = require('discord.js');
const { searchRules, getRulePage, suggestRuleTitles } = require('../services/rules');
const { createLogger } = require('../utils/logger');
const { createEmbed, makeFooter, truncateText } = require('../utils/embedUtils');

const log = createLogger('regel');

const CATEGORY_LABELS = {
    rules: 'Regeln',
    bestiarium: 'Bestiarium',
    magic: 'Magie & Zauber',
    götterwirken: 'Götterwirken & Liturgien',
    special_abilities_profane: 'Kampfsonderfertigkeiten',
    special_abilities_magical: 'Magische Sonderfertigkeiten',
    special_abilities_karmale: 'Karmale Sonderfertigkeiten',
    special_abilities_animal: 'Tier-Sonderfertigkeiten',
    ruestkammer_weapons: 'Waffen',
    ruestkammer_armor: 'Rüstungen',
    ruestkammer_equipment: 'Ausrüstung',
    ruestkammer_artifacts: 'Artefakte',
    ruestkammer_helmets: 'Helme',
    herbarium: 'Herbarium',
    poisons_and_illnesses: 'Gifte & Krankheiten',
    professions: 'Professionen',
    advantages: 'Vorteile',
    disadvantages: 'Nachteile',
    cultures: 'Kulturen',
    species: 'Spezies',
};

function formatCategoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
}

/**
 * Build embed for a selected page with match type indicators
 * @param {Object} page - The page to build embed for
 * @param {Array} exactMatches - List of exact matches
 * @param {Array} semanticMatches - List of semantic matches
 * @param {Object} user - Discord user for footer
 * @returns {EmbedBuilder} The built embed
 */
function buildPageEmbed(page, exactMatches, semanticMatches, user) {
    const pageTitle = page.title || 'Unbenannt';
    const pageContent = page.chunk_text || page.normalized_content || page.content || '';
    const pageSourceUrl = page.source_url;
    const preview = truncateText(pageContent, 1500, '');

    const embed = createEmbed('rules')
        .setTitle(pageSourceUrl ? `[${pageTitle}](${pageSourceUrl})` : pageTitle)
        .setDescription(preview || '*Kein Inhalt verfügbar.*');

    const fields = [];

    // Exact matches field
    if (exactMatches.length > 0) {
        const exactLines = exactMatches.map(match => {
            return match.source_url ? `[${match.title}](${match.source_url})` : match.title;
        });
        fields.push({
            name: '🎯 Exakte Treffer',
            value: exactLines.join('\n'),
            inline: false,
        });
    }

    // Semantic matches field
    if (semanticMatches.length > 0) {
        const semanticLines = semanticMatches.map(match => {
            const similarity = Math.round((match.similarity || 0) * 100);
            const titleLink = match.source_url ? `[${match.title}](${match.source_url})` : match.title;
            return `${titleLink} (${similarity}%)`;
        });
        fields.push({
            name: '🔍 Semantische Treffer',
            value: semanticLines.join('\n'),
            inline: false,
        });
    }

    if (fields.length > 0) {
        embed.addFields(fields);
    }

    embed.setFooter(makeFooter(user, 'DSA 5 Regelwiki ·')).setTimestamp();

    return embed;
}

/**
 * Build link button action row if URL exists
 * @param {string|null} sourceUrl - URL for the link button
 * @returns {ActionRowBuilder|null} The action row or null
 */
function buildLinkButtonRow(sourceUrl) {
    if (!sourceUrl) return null;

    const linkButton = new ButtonBuilder().setLabel('Im Regelwiki öffnen').setStyle(ButtonStyle.Link).setURL(sourceUrl);

    return new ActionRowBuilder().addComponents(linkButton);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('regel')
        .setDescription('Durchsuche das DSA 5 Regelwiki nach Regeln, Zaubern, Kreaturen und mehr.')
        .addStringOption(option =>
            option
                .setName('suche')
                .setDescription('Suchbegriff (z.B. "Finte", "Drache Kampfwerte", "Wundschwelle")')
                .setRequired(true)
                .setAutocomplete(true)
                .setMaxLength(200)
        )
        .addStringOption(option =>
            option
                .setName('kategorie')
                .setDescription('Ergebnisse auf eine Kategorie einschränken')
                .setRequired(false)
                .addChoices(
                    { name: 'Regeln', value: 'rules' },
                    { name: 'Bestiarium', value: 'bestiarium' },
                    { name: 'Magie & Zauber', value: 'magic' },
                    { name: 'Götterwirken & Liturgien', value: 'götterwirken' },
                    { name: 'Kampf-SF', value: 'special_abilities_profane' },
                    { name: 'Magische SF', value: 'special_abilities_magical' },
                    { name: 'Karmale SF', value: 'special_abilities_karmale' },
                    { name: 'Waffen', value: 'ruestkammer_weapons' },
                    { name: 'Rüstungen', value: 'ruestkammer_armor' },
                    { name: 'Ausrüstung', value: 'ruestkammer_equipment' },
                    { name: 'Artefakte', value: 'ruestkammer_artifacts' },
                    { name: 'Herbarium', value: 'herbarium' },
                    { name: 'Gifte & Krankheiten', value: 'poisons_and_illnesses' },
                    { name: 'Professionen', value: 'professions' },
                    { name: 'Vorteile', value: 'advantages' },
                    { name: 'Nachteile', value: 'disadvantages' },
                    { name: 'Kulturen', value: 'cultures' },
                    { name: 'Spezies', value: 'species' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('anzahl')
                .setDescription('Anzahl der Ergebnisse (1-5)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        )
        .addBooleanOption(option => option.setName('visible').setDescription('Ergebnis für alle sichtbar machen')),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const category = interaction.options.getString('kategorie');
        const cache = interaction.client.rulePageTitleCache || [];

        try {
            const matches = await suggestRuleTitles(
                { discordId: interaction.user.id },
                { query: focusedValue, category, cache }
            );
            const choices = matches.map(page => ({
                name: page.title,
                value: page.title,
            }));

            await interaction.respond(choices);
        } catch (error) {
            log.error({ error, focusedValue, category }, 'Autocomplete error');
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        const query = interaction.options.getString('suche');
        const category = interaction.options.getString('kategorie') || null;
        const limit = interaction.options.getInteger('anzahl') || 3;
        const visible = interaction.options.getBoolean('visible') || false;

        await interaction.deferReply({ ephemeral: !visible });

        try {
            const cache = interaction.client.rulePageTitleCache || [];
            const { selectedPage, exactMatches, semanticMatches } = await searchRules(
                { discordId: interaction.user.id },
                { query, category, limit, threshold: 0.4, cache }
            );

            // No results at all
            if (!selectedPage) {
                const noResultEmbed = createEmbed('warning')
                    .setTitle('📖 Regelsuche')
                    .setDescription(
                        `Keine Ergebnisse für **„${query}"**${category ? ` in *${formatCategoryLabel(category)}*` : ''}.\n\nVersuche andere Suchbegriffe oder entferne den Kategoriefilter.`
                    )
                    .setFooter({ text: 'DSA 5 Regelwiki · Semantische Suche' });

                return interaction.editReply({ embeds: [noResultEmbed] });
            }

            // Build primary embed for selected page
            const primaryEmbed = buildPageEmbed(selectedPage, exactMatches, semanticMatches, interaction.user);
            // Track current state for timeout handler
            let currentEmbed = primaryEmbed;
            let currentSourceUrl = selectedPage.source_url;

            // Build combined list for page picker (exact first, then semantic)
            const allPages = [...exactMatches, ...semanticMatches];
            const uniquePages = [];
            const seenDocIds = new Set();
            for (const page of allPages) {
                if (!seenDocIds.has(page.doc_id)) {
                    seenDocIds.add(page.doc_id);
                    uniquePages.push(page);
                }
            }

            // Only show picker if more than one page available
            if (uniquePages.length <= 1) {
                const components = [];
                const linkRow = buildLinkButtonRow(selectedPage.source_url);
                if (linkRow) components.push(linkRow);

                return interaction.editReply({
                    embeds: [primaryEmbed],
                    components: components.length > 0 ? components : undefined,
                });
            }

            // Build page picker select menu
            const selectOptions = uniquePages.slice(0, 25).map(page => ({
                label: page.title || 'Unbenannt',
                value: page.doc_id,
                description:
                    page.match_type === 'exact'
                        ? 'Exakter Treffer'
                        : `Semantisch (${Math.round((page.similarity || 0) * 100)}%)`,
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('regel_page_select')
                .setPlaceholder('Andere Seite auswählen...')
                .addOptions(selectOptions);

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);

            // Build initial components
            const components = [selectRow];
            const linkRow = buildLinkButtonRow(currentSourceUrl);
            if (linkRow) components.push(linkRow);

            const message = await interaction.editReply({
                embeds: [primaryEmbed],
                components,
                fetchReply: true,
            });

            // Set up collector for page selection
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id,
                time: 60000,
            });

            collector.on('collect', async i => {
                const selectedDocId = i.values[0];
                const selectedPageData = uniquePages.find(p => p.doc_id === selectedDocId);

                if (!selectedPageData) {
                    await i.reply({ content: '❌ Seite nicht gefunden.', ephemeral: true });
                    return;
                }

                // Fetch full content if not available (cache rows lack content)
                let pageData = selectedPageData;
                if (!selectedPageData.normalized_content && !selectedPageData.chunk_text && !selectedPageData.content) {
                    try {
                        const fullPage = await getRulePage({ discordId: interaction.user.id }, selectedDocId);
                        pageData = { ...selectedPageData, ...fullPage };
                    } catch {
                        // page not found — keep the cached metadata
                    }
                }

                // Rebuild embed with selected page as primary
                // Update match lists: selected page moves to top if it was in the lists
                const newExactMatches = exactMatches.filter(m => m.doc_id !== selectedDocId);
                const newSemanticMatches = semanticMatches.filter(m => m.doc_id !== selectedDocId);

                const newEmbed = buildPageEmbed(pageData, newExactMatches, newSemanticMatches, interaction.user);

                // Update components with new link button
                const newComponents = [selectRow];
                const newLinkRow = buildLinkButtonRow(pageData.source_url);
                if (newLinkRow) newComponents.push(newLinkRow);

                // Update current state for timeout handler
                currentEmbed = newEmbed;
                currentSourceUrl = pageData.source_url;

                await i.update({
                    embeds: [newEmbed],
                    components: newComponents,
                });
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    // Remove select menu but keep embed and link button
                    const cleanupComponents = [];
                    const linkRowCleanup = buildLinkButtonRow(currentSourceUrl);
                    if (linkRowCleanup) cleanupComponents.push(linkRowCleanup);

                    interaction
                        .editReply({
                            embeds: [currentEmbed],
                            components: cleanupComponents.length > 0 ? cleanupComponents : [],
                        })
                        .catch(() => {});
                }
            });

            return message;
        } catch (error) {
            log.error(
                { error, query, category, errorMessage: error?.message, errorStack: error?.stack },
                'Regel search failed'
            );

            if (error.message?.includes('OPENAI_API_KEY')) {
                return interaction.editReply({
                    content: '❌ Regelsuche nicht verfügbar — API-Schlüssel fehlt.',
                });
            }

            return interaction.editReply({
                content: '❌ Fehler bei der Regelsuche. Bitte versuche es erneut.',
            });
        }
    },
};
