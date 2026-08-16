const { AttachmentBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
    addEncounter,
    addObjective,
    advanceCampaignTime,
    createCampaignBackup,
    createCampaignRecord,
    createEncounterTable,
    createQuest,
    deleteCampaignRecord,
    drawEncounter,
    getCampaignRecord,
    getWorldState,
    listCampaignRecords,
    restoreCampaignBackup,
    setObjectiveStatus,
    setWorldState,
    updateCampaignRecord,
} = require('../services/campaign');
const { setFactionStanding } = require('../services/characterRecords');
const {
    createWebhookSubscription,
    deleteWebhookSubscription,
    listWebhookSubscriptions,
    testWebhookSubscription,
} = require('../services/webhooks');
const { generateNpc, getQuestObjectives, parseObjectiveList, validateHttpsUrl } = require('../utils/campaignUtils');
const {
    buildCampaignRecordListEmbeds,
    buildEncounterTableEmbed,
    buildNpcEmbed,
    buildQuestEmbed,
    buildWebhookListEmbeds,
    buildWorldEmbed,
} = require('../utils/campaignViews');
const { readJsonAttachment } = require('../utils/attachmentJson');
const { createLogger } = require('../utils/logger');

const log = createLogger('campaign');

function recordOption(subcommand, name = 'record', description = 'Campaign record') {
    return subcommand.addStringOption(option =>
        option.setName(name).setDescription(description).setAutocomplete(true).setRequired(true)
    );
}

function visibleOption(subcommand) {
    return subcommand.addBooleanOption(option =>
        option.setName('visible').setDescription('Make the result visible to everyone')
    );
}

const data = new SlashCommandBuilder()
    .setName('campaign')
    .setDescription('Manage campaign tools and integrations')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup(group =>
        group
            .setName('quest')
            .setDescription('Manage quests and objectives')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Create a quest')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Quest name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('summary').setDescription('Quest summary').setMaxLength(2000)
                    )
                    .addStringOption(option =>
                        option.setName('objectives').setDescription('Semicolon-separated objectives').setMaxLength(1500)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List quests'))
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('show').setDescription('Show a quest'), 'quest', 'Quest')
            )
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('objective').setDescription('Add a quest objective'),
                    'quest',
                    'Quest'
                ).addStringOption(option =>
                    option.setName('text').setDescription('Objective').setMaxLength(300).setRequired(true)
                )
            )
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('mark').setDescription('Mark an objective complete or open'),
                    'quest',
                    'Quest'
                )
                    .addStringOption(option =>
                        option.setName('objective').setDescription('Objective').setAutocomplete(true).setRequired(true)
                    )
                    .addBooleanOption(option =>
                        option
                            .setName('completed')
                            .setDescription('Whether the objective is complete')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('status').setDescription('Change quest status'),
                    'quest',
                    'Quest'
                ).addStringOption(option =>
                    option
                        .setName('status')
                        .setDescription('Quest status')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Active', value: 'ACTIVE' },
                            { name: 'Completed', value: 'COMPLETED' },
                            { name: 'Failed', value: 'FAILED' },
                            { name: 'Archived', value: 'ARCHIVED' }
                        )
                )
            )
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('delete').setDescription('Delete a quest'), 'quest', 'Quest')
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('encounter')
            .setDescription('Manage random encounter tables')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('create')
                    .setDescription('Create an encounter table')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Table name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('description').setDescription('Table description').setMaxLength(1000)
                    )
            )
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('add').setDescription('Add an encounter'), 'table', 'Encounter table')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Encounter name').setMaxLength(100).setRequired(true)
                    )
                    .addIntegerOption(option =>
                        option.setName('weight').setDescription('Relative weight').setMinValue(1).setMaxValue(1000)
                    )
                    .addStringOption(option =>
                        option.setName('details').setDescription('Encounter details').setMaxLength(1000)
                    )
            )
            .addSubcommand(subcommand =>
                visibleOption(
                    recordOption(
                        subcommand.setName('roll').setDescription('Draw an encounter'),
                        'table',
                        'Encounter table'
                    )
                )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List encounter tables'))
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('show').setDescription('Show an encounter table'),
                    'table',
                    'Encounter table'
                )
            )
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('delete').setDescription('Delete an encounter table'),
                    'table',
                    'Encounter table'
                )
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('world')
            .setDescription('Track campaign time and weather')
            .addSubcommand(subcommand =>
                visibleOption(subcommand.setName('show').setDescription('Show world time and weather'))
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('set')
                    .setDescription('Set world time or weather')
                    .addStringOption(option =>
                        option.setName('time').setDescription('ISO date/time, e.g. 2026-08-15T18:00:00Z')
                    )
                    .addStringOption(option =>
                        option.setName('weather').setDescription('Weather description').setMaxLength(100)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('advance')
                    .setDescription('Advance campaign time')
                    .addIntegerOption(option =>
                        option
                            .setName('amount')
                            .setDescription('Amount')
                            .setMinValue(-3650)
                            .setMaxValue(3650)
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('unit')
                            .setDescription('Time unit')
                            .setRequired(true)
                            .addChoices(
                                { name: 'Minutes', value: 'MINUTES' },
                                { name: 'Hours', value: 'HOURS' },
                                { name: 'Days', value: 'DAYS' }
                            )
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('weather')
                    .setDescription('Set or randomly generate weather')
                    .addStringOption(option =>
                        option.setName('description').setDescription('Leave empty for random weather').setMaxLength(100)
                    )
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('map')
            .setDescription('Link campaign maps')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add a map link')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Map name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('url').setDescription('HTTPS map URL').setMaxLength(1000).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('description').setDescription('Map description').setMaxLength(1000)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List map links'))
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('delete').setDescription('Delete a map link'), 'map', 'Map')
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('stronghold')
            .setDescription('Manage strongholds and bases')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add a stronghold or base')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Stronghold name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option => option.setName('location').setDescription('Location').setMaxLength(200))
                    .addStringOption(option =>
                        option.setName('description').setDescription('Description').setMaxLength(1500)
                    )
                    .addIntegerOption(option =>
                        option.setName('level').setDescription('Development level').setMinValue(1).setMaxValue(100)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List strongholds and bases'))
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('update').setDescription('Update a stronghold'),
                    'stronghold',
                    'Stronghold'
                )
                    .addStringOption(option =>
                        option.setName('description').setDescription('Replacement description').setMaxLength(1500)
                    )
                    .addIntegerOption(option =>
                        option.setName('level').setDescription('Development level').setMinValue(1).setMaxValue(100)
                    )
            )
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('delete').setDescription('Delete a stronghold'),
                    'stronghold',
                    'Stronghold'
                )
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('faction')
            .setDescription('Manage factions and reputation')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add a faction')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Faction name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('description').setDescription('Faction description').setMaxLength(1500)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List factions'))
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('standing').setDescription('Set a party member reputation'),
                    'faction',
                    'Faction'
                )
                    .addUserOption(option =>
                        option.setName('member').setDescription('Enrolled party member').setRequired(true)
                    )
                    .addIntegerOption(option =>
                        option
                            .setName('value')
                            .setDescription('Standing from -100 to 100')
                            .setMinValue(-100)
                            .setMaxValue(100)
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('note').setDescription('Reason or title').setMaxLength(500)
                    )
            )
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('delete').setDescription('Delete a faction'), 'faction', 'Faction')
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('npc')
            .setDescription('Generate quick NPCs')
            .addSubcommand(subcommand =>
                visibleOption(subcommand.setName('generate').setDescription('Generate a random NPC'))
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('alchemy')
            .setDescription('Manage campaign alchemy recipes')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('recipe-add')
                    .setDescription('Add an alchemy recipe')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Recipe name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('ingredients')
                            .setDescription('Required ingredients')
                            .setMaxLength(1500)
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('result').setDescription('Brew result').setMaxLength(1500).setRequired(true)
                    )
                    .addIntegerOption(option =>
                        option
                            .setName('difficulty')
                            .setDescription('Progress required')
                            .setMinValue(1)
                            .setMaxValue(100)
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('recipe-list').setDescription('List alchemy recipes'))
            .addSubcommand(subcommand =>
                recordOption(
                    subcommand.setName('recipe-delete').setDescription('Delete an alchemy recipe'),
                    'recipe',
                    'Recipe'
                )
            )
    )
    .addSubcommandGroup(group =>
        group
            .setName('webhook')
            .setDescription('Manage outbound API webhooks')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('Add an HTTPS webhook')
                    .addStringOption(option =>
                        option.setName('name').setDescription('Webhook name').setMaxLength(100).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('url').setDescription('HTTPS endpoint').setMaxLength(1000).setRequired(true)
                    )
                    .addStringOption(option =>
                        option.setName('events').setDescription('Comma-separated events or *').setMaxLength(200)
                    )
            )
            .addSubcommand(subcommand => subcommand.setName('list').setDescription('List redacted webhook endpoints'))
            .addSubcommand(subcommand =>
                recordOption(subcommand.setName('delete').setDescription('Delete a webhook'), 'webhook', 'Webhook')
            )
            .addSubcommand(subcommand => subcommand.setName('test').setDescription('Send a signed test event'))
    )
    .addSubcommandGroup(group =>
        group
            .setName('backup')
            .setDescription('Back up or restore campaign data')
            .addSubcommand(subcommand => subcommand.setName('create').setDescription('Download a campaign JSON backup'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('restore')
                    .setDescription('Restore a campaign JSON backup')
                    .addAttachmentOption(option =>
                        option.setName('file').setDescription('DSANewBot campaign backup').setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('mode')
                            .setDescription('Merge or replace campaign records')
                            .setRequired(true)
                            .addChoices({ name: 'Merge', value: 'MERGE' }, { name: 'Replace', value: 'REPLACE' })
                    )
                    .addBooleanOption(option => option.setName('confirm').setDescription('Required for replace mode'))
            )
    );

const RECORD_KIND_BY_GROUP = {
    quest: 'QUEST',
    encounter: 'ENCOUNTER_TABLE',
    map: 'MAP',
    stronghold: 'STRONGHOLD',
    faction: 'FACTION',
    alchemy: 'ALCHEMY_RECIPE',
};

module.exports = {
    data,

    async autocomplete(interaction) {
        try {
            if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return interaction.respond([]);
            }
            const group = interaction.options.getSubcommandGroup();
            const focused = interaction.options.getFocused(true);
            const ctx = { discordId: interaction.user.id, role: 'DM' };
            if (group === 'webhook') {
                const rows = await listWebhookSubscriptions(ctx, interaction.guildId);
                return interaction.respond(
                    rows
                        .filter(row => row.name.toLowerCase().includes(focused.value.toLowerCase()))
                        .slice(0, 25)
                        .map(row => ({ name: row.name, value: row.id }))
                );
            }
            if (group === 'quest' && focused.name === 'objective') {
                const questId = interaction.options.getString('quest');
                if (!questId) return interaction.respond([]);
                const quest = await getCampaignRecord(ctx, interaction.guildId, questId, 'QUEST');
                return interaction.respond(
                    getQuestObjectives(quest.data)
                        .filter(objective => objective.text.toLowerCase().includes(focused.value.toLowerCase()))
                        .slice(0, 25)
                        .map(objective => ({
                            name: `${objective.completed ? '✅' : '⬜'} ${objective.text}`.slice(0, 100),
                            value: objective.id,
                        }))
                );
            }
            const kind = RECORD_KIND_BY_GROUP[group];
            if (!kind) return interaction.respond([]);
            const rows = await listCampaignRecords(ctx, interaction.guildId, kind);
            return interaction.respond(
                rows
                    .filter(row => row.name.toLowerCase().includes(focused.value.toLowerCase()))
                    .slice(0, 25)
                    .map(row => ({ name: row.name, value: row.id }))
            );
        } catch (error) {
            log.warn({ error }, 'Campaign autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        if (!interaction.guildId)
            return interaction.reply({ content: '❌ Campaign tools require a server.', ephemeral: true });
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ Campaign tools require Manage Server permission.',
                ephemeral: true,
            });
        }
        const group = interaction.options.getSubcommandGroup();
        const subcommand = interaction.options.getSubcommand();
        const visible = interaction.options.getBoolean('visible') || false;
        await interaction.deferReply({ ephemeral: !visible });
        const ctx = { discordId: interaction.user.id, role: 'DM' };
        const guildId = interaction.guildId;

        try {
            if (group === 'npc') {
                return interaction.editReply({ embeds: [buildNpcEmbed(generateNpc(), interaction.user)] });
            }

            if (group === 'quest') {
                if (subcommand === 'add') {
                    const quest = await createQuest(ctx, {
                        guildId,
                        name: interaction.options.getString('name', true),
                        summary: interaction.options.getString('summary') || undefined,
                        objectives: parseObjectiveList(interaction.options.getString('objectives') || undefined),
                    });
                    return interaction.editReply({ embeds: [buildQuestEmbed(quest, interaction.user)] });
                }
                if (subcommand === 'list') {
                    const records = await listCampaignRecords(ctx, guildId, 'QUEST');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('QUEST', records, interaction.user),
                    });
                }
                const questId = interaction.options.getString('quest', true);
                if (subcommand === 'show') {
                    const quest = await getCampaignRecord(ctx, guildId, questId, 'QUEST');
                    return interaction.editReply({ embeds: [buildQuestEmbed(quest, interaction.user)] });
                }
                if (subcommand === 'objective') {
                    const quest = await addObjective(
                        ctx,
                        guildId,
                        questId,
                        interaction.options.getString('text', true)
                    );
                    return interaction.editReply({ embeds: [buildQuestEmbed(quest, interaction.user)] });
                }
                if (subcommand === 'mark') {
                    const quest = await setObjectiveStatus(
                        ctx,
                        guildId,
                        questId,
                        interaction.options.getString('objective', true),
                        interaction.options.getBoolean('completed', true)
                    );
                    return interaction.editReply({ embeds: [buildQuestEmbed(quest, interaction.user)] });
                }
                if (subcommand === 'status') {
                    const quest = await updateCampaignRecord(ctx, {
                        guildId,
                        recordId: questId,
                        kind: 'QUEST',
                        status: interaction.options.getString('status', true),
                    });
                    return interaction.editReply({ embeds: [buildQuestEmbed(quest, interaction.user)] });
                }
                const deleted = await deleteCampaignRecord(ctx, guildId, questId, 'QUEST');
                return interaction.editReply(`✅ Deleted quest **${deleted.name}**.`);
            }

            if (group === 'encounter') {
                if (subcommand === 'create') {
                    const table = await createEncounterTable(
                        ctx,
                        guildId,
                        interaction.options.getString('name', true),
                        interaction.options.getString('description') || undefined
                    );
                    return interaction.editReply({ embeds: [buildEncounterTableEmbed(table, interaction.user)] });
                }
                if (subcommand === 'list') {
                    const records = await listCampaignRecords(ctx, guildId, 'ENCOUNTER_TABLE');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('ENCOUNTER_TABLE', records, interaction.user),
                    });
                }
                const tableId = interaction.options.getString('table', true);
                if (subcommand === 'add') {
                    const table = await addEncounter(ctx, {
                        guildId,
                        tableId,
                        name: interaction.options.getString('name', true),
                        weight: interaction.options.getInteger('weight') || undefined,
                        details: interaction.options.getString('details') || undefined,
                    });
                    return interaction.editReply({ embeds: [buildEncounterTableEmbed(table, interaction.user)] });
                }
                if (subcommand === 'roll') {
                    const result = await drawEncounter(ctx, guildId, tableId);
                    return interaction.editReply(
                        `🎲 **${result.table.name}: ${result.entry.name}**${result.entry.details ? `\n${result.entry.details}` : ''}`
                    );
                }
                if (subcommand === 'show') {
                    const table = await getCampaignRecord(ctx, guildId, tableId, 'ENCOUNTER_TABLE');
                    return interaction.editReply({ embeds: [buildEncounterTableEmbed(table, interaction.user)] });
                }
                const deleted = await deleteCampaignRecord(ctx, guildId, tableId, 'ENCOUNTER_TABLE');
                return interaction.editReply(`✅ Deleted encounter table **${deleted.name}**.`);
            }

            if (group === 'world') {
                let world;
                if (subcommand === 'show') world = await getWorldState(ctx, guildId);
                else if (subcommand === 'set') {
                    world = await setWorldState(ctx, {
                        guildId,
                        currentTime: interaction.options.getString('time') || undefined,
                        weather: interaction.options.getString('weather') || undefined,
                    });
                } else if (subcommand === 'advance') {
                    world = await advanceCampaignTime(ctx, {
                        guildId,
                        amount: interaction.options.getInteger('amount', true),
                        unit: interaction.options.getString('unit', true),
                    });
                } else {
                    const description = interaction.options.getString('description');
                    world = await setWorldState(ctx, {
                        guildId,
                        weather: description || undefined,
                        randomizeWeather: !description,
                    });
                }
                return interaction.editReply({ embeds: [buildWorldEmbed(world, interaction.user)] });
            }

            if (group === 'map') {
                if (subcommand === 'add') {
                    const record = await createCampaignRecord(ctx, {
                        guildId,
                        kind: 'MAP',
                        name: interaction.options.getString('name', true),
                        data: {
                            url: validateHttpsUrl(interaction.options.getString('url', true), 'map URL'),
                            description: interaction.options.getString('description') || '',
                        },
                    });
                    return interaction.editReply(`✅ Added map **${record.name}**.`);
                }
                if (subcommand === 'list') {
                    const records = await listCampaignRecords(ctx, guildId, 'MAP');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('MAP', records, interaction.user),
                    });
                }
                const deleted = await deleteCampaignRecord(
                    ctx,
                    guildId,
                    interaction.options.getString('map', true),
                    'MAP'
                );
                return interaction.editReply(`✅ Deleted map **${deleted.name}**.`);
            }

            if (group === 'stronghold') {
                if (subcommand === 'add') {
                    const record = await createCampaignRecord(ctx, {
                        guildId,
                        kind: 'STRONGHOLD',
                        name: interaction.options.getString('name', true),
                        data: {
                            location: interaction.options.getString('location') || '',
                            description: interaction.options.getString('description') || '',
                            level: interaction.options.getInteger('level') || 1,
                        },
                    });
                    return interaction.editReply(`✅ Added stronghold **${record.name}**.`);
                }
                if (subcommand === 'list') {
                    const records = await listCampaignRecords(ctx, guildId, 'STRONGHOLD');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('STRONGHOLD', records, interaction.user),
                    });
                }
                const recordId = interaction.options.getString('stronghold', true);
                if (subcommand === 'update') {
                    const existing = await getCampaignRecord(ctx, guildId, recordId, 'STRONGHOLD');
                    const record = await updateCampaignRecord(ctx, {
                        guildId,
                        recordId,
                        kind: 'STRONGHOLD',
                        data: {
                            ...existing.data,
                            ...(interaction.options.getString('description') === null
                                ? {}
                                : { description: interaction.options.getString('description') }),
                            ...(interaction.options.getInteger('level') === null
                                ? {}
                                : { level: interaction.options.getInteger('level') }),
                        },
                    });
                    return interaction.editReply(`✅ Updated stronghold **${record.name}**.`);
                }
                const deleted = await deleteCampaignRecord(ctx, guildId, recordId, 'STRONGHOLD');
                return interaction.editReply(`✅ Deleted stronghold **${deleted.name}**.`);
            }

            if (group === 'faction') {
                if (subcommand === 'add') {
                    const record = await createCampaignRecord(ctx, {
                        guildId,
                        kind: 'FACTION',
                        name: interaction.options.getString('name', true),
                        data: { description: interaction.options.getString('description') || '' },
                    });
                    return interaction.editReply(`✅ Added faction **${record.name}**.`);
                }
                if (subcommand === 'list') {
                    const records = await listCampaignRecords(ctx, guildId, 'FACTION');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('FACTION', records, interaction.user),
                    });
                }
                const factionId = interaction.options.getString('faction', true);
                if (subcommand === 'standing') {
                    const member = interaction.options.getUser('member', true);
                    const record = await setFactionStanding(ctx, {
                        guildId,
                        targetDiscordId: member.id,
                        factionId,
                        standing: interaction.options.getInteger('value', true),
                        note: interaction.options.getString('note') || undefined,
                    });
                    return interaction.editReply(
                        `✅ Set **${member.username}** to **${record.data.standing}** with **${record.name}**.`
                    );
                }
                const deleted = await deleteCampaignRecord(ctx, guildId, factionId, 'FACTION');
                return interaction.editReply(`✅ Deleted faction **${deleted.name}**.`);
            }

            if (group === 'alchemy') {
                if (subcommand === 'recipe-add') {
                    const record = await createCampaignRecord(ctx, {
                        guildId,
                        kind: 'ALCHEMY_RECIPE',
                        name: interaction.options.getString('name', true),
                        data: {
                            ingredients: interaction.options.getString('ingredients', true),
                            result: interaction.options.getString('result', true),
                            difficulty: interaction.options.getInteger('difficulty', true),
                        },
                    });
                    return interaction.editReply(`✅ Added alchemy recipe **${record.name}**.`);
                }
                if (subcommand === 'recipe-list') {
                    const records = await listCampaignRecords(ctx, guildId, 'ALCHEMY_RECIPE');
                    return interaction.editReply({
                        embeds: buildCampaignRecordListEmbeds('ALCHEMY_RECIPE', records, interaction.user),
                    });
                }
                const deleted = await deleteCampaignRecord(
                    ctx,
                    guildId,
                    interaction.options.getString('recipe', true),
                    'ALCHEMY_RECIPE'
                );
                return interaction.editReply(`✅ Deleted recipe **${deleted.name}**.`);
            }

            if (group === 'webhook') {
                if (subcommand === 'add') {
                    const webhook = await createWebhookSubscription(ctx, {
                        guildId,
                        name: interaction.options.getString('name', true),
                        url: interaction.options.getString('url', true),
                        events: interaction.options.getString('events') || undefined,
                    });
                    return interaction.editReply(
                        `✅ Added webhook **${webhook.name}** for ${webhook.event_types.join(', ')}.`
                    );
                }
                if (subcommand === 'list') {
                    const webhooks = await listWebhookSubscriptions(ctx, guildId);
                    return interaction.editReply({ embeds: buildWebhookListEmbeds(webhooks, interaction.user) });
                }
                if (subcommand === 'test') {
                    const result = await testWebhookSubscription(ctx, guildId);
                    return interaction.editReply(
                        `🔗 Webhook test: **${result.delivered} delivered**, **${result.failed} failed**.`
                    );
                }
                const webhook = await deleteWebhookSubscription(
                    ctx,
                    guildId,
                    interaction.options.getString('webhook', true)
                );
                return interaction.editReply(`✅ Deleted webhook **${webhook.name}**.`);
            }

            if (group === 'backup') {
                if (subcommand === 'create') {
                    const backup = await createCampaignBackup(ctx, guildId);
                    const file = new AttachmentBuilder(Buffer.from(`${JSON.stringify(backup, null, 2)}\n`), {
                        name: `dsanewbot-campaign-${guildId}.json`,
                    });
                    return interaction.editReply({
                        content: '✅ Campaign backup created. Webhook URLs are intentionally excluded.',
                        files: [file],
                    });
                }
                const mode = interaction.options.getString('mode', true);
                if (mode === 'REPLACE' && !interaction.options.getBoolean('confirm')) {
                    return interaction.editReply('❌ Replace mode requires `confirm:true`. No data was changed.');
                }
                const raw = await readJsonAttachment(interaction.options.getAttachment('file', true));
                const restored = await restoreCampaignBackup(ctx, guildId, raw, mode);
                return interaction.editReply(
                    `✅ Restored **${restored.records}** records in ${restored.mode.toLowerCase()} mode.`
                );
            }

            throw new Error('Unsupported campaign command');
        } catch (error) {
            log.error({ error, guildId, group, subcommand }, 'Campaign command failed');
            return interaction.editReply(`❌ ${error.status ? error.message : 'Failed to manage campaign data.'}`);
        }
    },
};
