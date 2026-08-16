const mockCampaignServices = {
    addEncounter: jest.fn(),
    addObjective: jest.fn(),
    advanceCampaignTime: jest.fn(),
    createCampaignBackup: jest.fn(),
    createCampaignRecord: jest.fn(),
    createEncounterTable: jest.fn(),
    createQuest: jest.fn(),
    deleteCampaignRecord: jest.fn(),
    drawEncounter: jest.fn(),
    getCampaignRecord: jest.fn(),
    getWorldState: jest.fn(),
    listCampaignRecords: jest.fn(),
    restoreCampaignBackup: jest.fn(),
    setObjectiveStatus: jest.fn(),
    setWorldState: jest.fn(),
    updateCampaignRecord: jest.fn(),
};
const mockWebhookServices = {
    createWebhookSubscription: jest.fn(),
    deleteWebhookSubscription: jest.fn(),
    listWebhookSubscriptions: jest.fn(),
    testWebhookSubscription: jest.fn(),
};

jest.mock('../services/campaign', () => mockCampaignServices);
jest.mock('../services/characterRecords', () => ({ setFactionStanding: jest.fn() }));
jest.mock('../services/webhooks', () => mockWebhookServices);
jest.mock('../utils/campaignUtils', () => ({
    generateNpc: jest.fn(() => ({ name: 'Alrik', role: 'Guard', stats: {} })),
    getQuestObjectives: jest.fn(() => []),
    parseObjectiveList: jest.fn(value => (value ? value.split(';') : [])),
    validateHttpsUrl: jest.fn(value => value),
}));
jest.mock('../utils/campaignViews', () => ({
    buildCampaignRecordListEmbeds: jest.fn(() => [{ title: 'list' }]),
    buildEncounterTableEmbed: jest.fn(() => ({ title: 'encounter' })),
    buildNpcEmbed: jest.fn(() => ({ title: 'npc' })),
    buildQuestEmbed: jest.fn(() => ({ title: 'quest' })),
    buildWebhookListEmbeds: jest.fn(() => [{ title: 'webhooks' }]),
    buildWorldEmbed: jest.fn(() => ({ title: 'world' })),
}));
jest.mock('../utils/attachmentJson', () => ({ readJsonAttachment: jest.fn() }));

const command = require('../commands/campaign');

describe('/campaign authorization and routing', () => {
    beforeEach(() => jest.clearAllMocks());

    test('rejects callers without Manage Server before storage access', async () => {
        const interaction = {
            guildId: 'guild-1',
            memberPermissions: { has: jest.fn(() => false) },
            reply: jest.fn(),
        };
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({
            content: '❌ Campaign tools require Manage Server permission.',
            ephemeral: true,
        });
        expect(mockCampaignServices.listCampaignRecords).not.toHaveBeenCalled();
    });

    test('creates a quest through a DM context scoped to the current guild', async () => {
        const quest = { id: 'quest-1', name: 'Relic', data: {}, status: 'ACTIVE' };
        mockCampaignServices.createQuest.mockResolvedValue(quest);
        const values = { name: 'Relic', summary: 'Find it', objectives: 'Search;Return' };
        const interaction = {
            guildId: 'guild-1',
            user: { id: 'dm-1' },
            memberPermissions: { has: jest.fn(() => true) },
            options: {
                getSubcommandGroup: () => 'quest',
                getSubcommand: () => 'add',
                getBoolean: () => false,
                getString: name => values[name] ?? null,
            },
            deferReply: jest.fn(),
            editReply: jest.fn(),
        };
        await command.execute(interaction);
        expect(mockCampaignServices.createQuest).toHaveBeenCalledWith(
            { discordId: 'dm-1', role: 'DM' },
            { guildId: 'guild-1', name: 'Relic', summary: 'Find it', objectives: ['Search', 'Return'] }
        );
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [{ title: 'quest' }] });
    });

    test('generates an NPC without touching persistent storage', async () => {
        const interaction = {
            guildId: 'guild-1',
            user: { id: 'dm-1' },
            memberPermissions: { has: jest.fn(() => true) },
            options: {
                getSubcommandGroup: () => 'npc',
                getSubcommand: () => 'generate',
                getBoolean: () => true,
            },
            deferReply: jest.fn(),
            editReply: jest.fn(),
        };
        await command.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [{ title: 'npc' }] });
        expect(mockCampaignServices.createCampaignRecord).not.toHaveBeenCalled();
    });
});
