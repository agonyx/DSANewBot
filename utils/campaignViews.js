const { buildListEmbeds, createEmbed, makeFooter, progressBar, truncateText } = require('./embedUtils');
const { getEncounterEntries, getQuestObjectives } = require('./campaignUtils');

function buildCampaignRecordListEmbeds(kind, records, user) {
    const labels = {
        QUEST: '📜 Quests',
        ENCOUNTER_TABLE: '🎲 Encounter Tables',
        MAP: '🗺️ Maps',
        STRONGHOLD: '🏰 Strongholds & Bases',
        FACTION: '⚖️ Factions',
        ALCHEMY_RECIPE: '⚗️ Alchemy Recipes',
    };
    return buildListEmbeds({
        title: labels[kind] || 'Campaign Records',
        theme: 'info',
        description: `**${records.length} record${records.length === 1 ? '' : 's'}**`,
        lines: records.map(record => {
            const data = record.data || {};
            const detail = data.url
                ? `[Open map](${data.url})${data.description ? ` · ${data.description}` : ''}`
                : data.summary ||
                  data.description ||
                  data.location ||
                  (data.result
                      ? `${data.result}${data.ingredients ? ` · Ingredients: ${data.ingredients}` : ''}`
                      : '') ||
                  data.ingredients ||
                  'No description.';
            return `**${record.name}** · ${record.status}\n${truncateText(detail, 240)}`;
        }),
        emptyMessage: `No ${String(kind).toLowerCase().replaceAll('_', ' ')} records yet.`,
        footer: makeFooter(user),
    });
}

function buildQuestEmbed(quest, user) {
    const objectives = getQuestObjectives(quest.data || {});
    const completed = objectives.filter(objective => objective.completed).length;
    return createEmbed(quest.status === 'COMPLETED' ? 'success' : 'info')
        .setTitle(`📜 ${truncateText(quest.name, 250)}`)
        .setDescription(truncateText(quest.data?.summary || 'No summary.', 3000))
        .addFields({
            name: `Objectives · ${completed}/${objectives.length}`,
            value: truncateText(
                objectives.length
                    ? objectives.map(objective => `${objective.completed ? '✅' : '⬜'} ${objective.text}`).join('\n')
                    : 'No objectives yet.',
                1024
            ),
        })
        .setFooter(makeFooter(user));
}

function buildEncounterTableEmbed(table, user) {
    const entries = getEncounterEntries(table.data || {});
    return createEmbed('warning')
        .setTitle(`🎲 ${truncateText(table.name, 250)}`)
        .setDescription(truncateText(table.data?.description || 'Random encounter table.', 2500))
        .addFields({
            name: `${entries.length} entries`,
            value: truncateText(
                entries.length
                    ? entries
                          .map(
                              entry =>
                                  `**${entry.name}** · weight ${entry.weight}${entry.details ? `\n↳ ${entry.details}` : ''}`
                          )
                          .join('\n')
                    : 'No entries yet.',
                1024
            ),
        })
        .setFooter(makeFooter(user));
}

function buildWorldEmbed(world, user) {
    const timestamp = Math.floor(new Date(world.current_time).getTime() / 1000);
    return createEmbed('info')
        .setTitle('🌦️ Campaign World')
        .setDescription(`**Time:** <t:${timestamp}:F>\n**Weather:** ${truncateText(world.weather, 200)}`)
        .setFooter(makeFooter(user));
}

function buildNpcEmbed(npc, user) {
    return createEmbed('character')
        .setTitle(`🧑 ${npc.name} · ${npc.role}`)
        .setDescription(`**Trait:** ${npc.trait}\n**Motive:** ${npc.motive}`)
        .addFields({
            name: 'Quick stats',
            value: `MU ${npc.stats.courage} · INI ${npc.stats.initiative} · AT ${npc.stats.attack} · PA ${npc.stats.parry} · LeP ${npc.stats.lifePoints}`,
        })
        .setFooter(makeFooter(user, 'Generated for'));
}

function buildCharacterRecordListEmbeds(title, records, user) {
    return buildListEmbeds({
        title,
        theme: 'character',
        description: `**${records.length} record${records.length === 1 ? '' : 's'}**`,
        lines: records.map(record => {
            const data = record.data || {};
            const progress = Number.isFinite(Number(data.target))
                ? `\n${progressBar(Number(data.progress || 0), Number(data.target))} ${data.progress || 0}/${data.target}`
                : '';
            const detail =
                data.standing !== undefined
                    ? `Standing **${data.standing}**${data.note ? ` · ${data.note}` : ''}`
                    : data.culture || data.profession
                      ? `${data.culture || 'Unknown culture'} · ${data.profession || 'Unknown profession'}${data.notes ? `\n${data.notes}` : ''}`
                      : data.species
                        ? `${data.species}${data.description ? ` · ${data.description}` : ''}`
                        : data.description || data.note || data.result || data.materials || '';
            return `**${record.name}** · ${record.status}${progress}${detail ? `\n${truncateText(detail, 220)}` : ''}`;
        }),
        emptyMessage: 'Nothing saved yet.',
        footer: makeFooter(user),
    });
}

function buildWebhookListEmbeds(webhooks, user) {
    return buildListEmbeds({
        title: '🔗 Webhook Integrations',
        theme: 'info',
        lines: webhooks.map(
            webhook =>
                `**${webhook.name}** · ${webhook.enabled ? 'enabled' : 'disabled'}\n${webhook.url} · ${webhook.event_types.join(', ')}`
        ),
        emptyMessage: 'No webhook integrations configured.',
        footer: makeFooter(user),
    });
}

module.exports = {
    buildCampaignRecordListEmbeds,
    buildCharacterRecordListEmbeds,
    buildEncounterTableEmbed,
    buildNpcEmbed,
    buildQuestEmbed,
    buildWebhookListEmbeds,
    buildWorldEmbed,
};
