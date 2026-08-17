jest.mock('../utils/campaignUtils', () => ({
    getEncounterEntries: data => data.entries || [],
    getQuestObjectives: data => data.objectives || [],
}));

const {
    buildCampaignRecordListEmbeds,
    buildCharacterRecordListEmbeds,
    buildEncounterTableEmbed,
    buildQuestEmbed,
} = require('../utils/campaignViews');

function expectValidEmbeds(embeds) {
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds.length).toBeLessThanOrEqual(10);
    for (const builder of embeds) {
        const embed = builder.toJSON();
        expect(embed.title?.length || 0).toBeLessThanOrEqual(256);
        expect(embed.description?.length || 0).toBeLessThanOrEqual(4096);
        expect(embed.fields?.length || 0).toBeLessThanOrEqual(25);
        for (const field of embed.fields || []) expect(field.value.length).toBeLessThanOrEqual(1024);
    }
}

describe('campaign and character record views', () => {
    const user = { username: 'Rondra', avatarURL: () => undefined };

    test('paginates maximum campaign and character record lists', () => {
        const records = Array.from({ length: 100 }, (_, index) => ({
            id: `record-${index}`,
            name: `Record ${index + 1}`,
            status: 'ACTIVE',
            data: { description: 'A'.repeat(300), progress: index, target: 100 },
        }));
        const campaign = buildCampaignRecordListEmbeds('STRONGHOLD', records, user);
        const character = buildCharacterRecordListEmbeds('Projects', records, user);
        expectValidEmbeds(campaign);
        expectValidEmbeds(character);
        expect(campaign.map(embed => embed.toJSON().description).join('\n')).toContain('Record 100');
    });

    test('bounds quest and encounter detail payloads', () => {
        const quest = buildQuestEmbed(
            {
                name: 'Epic Quest',
                status: 'ACTIVE',
                data: {
                    summary: 'S'.repeat(4000),
                    objectives: Array.from({ length: 25 }, (_, index) => ({
                        id: String(index),
                        text: `Objective ${index + 1} ${'O'.repeat(280)}`,
                        completed: index % 2 === 0,
                    })),
                },
            },
            user
        );
        const table = buildEncounterTableEmbed(
            {
                name: 'Wilds',
                data: {
                    description: 'D'.repeat(4000),
                    entries: Array.from({ length: 100 }, (_, index) => ({
                        id: String(index),
                        name: `Encounter ${index + 1}`,
                        weight: 1,
                        details: 'E'.repeat(500),
                    })),
                },
            },
            user
        );
        expectValidEmbeds([quest, table]);
    });
});
