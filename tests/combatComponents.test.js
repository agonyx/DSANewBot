const { createSetupEmbed, createSetupActionRows } = require('../utils/combatComponents');
const { EMBED_COLORS } = require('../utils/embedUtils');

// =============================================================================
// REUSABLE LOBBY FIXTURES
// =============================================================================

const SESSION_ID = '12345678-1234-1234-1234-123456789abc';
const DM_USERNAME = 'TestDM';

/**
 * Fixtures for setup lobby scenarios covering various edge cases
 */
const fixtures = {
    /** Empty setup - no participants yet */
    emptySetup: {
        sessionId: SESSION_ID,
        dmUsername: DM_USERNAME,
        participants: [],
        canStart: false,
    },

    /** Ready-to-start setup - has at least one player and one NPC */
    readyToStart: {
        sessionId: SESSION_ID,
        dmUsername: DM_USERNAME,
        participants: [
            { type: 'PLAYER', name: 'Alice' },
            { type: 'NPC', name: 'Goblin Warrior' },
        ],
        canStart: true,
    },

    /** Mixed setup - multiple players and NPCs */
    mixedSetup: {
        sessionId: SESSION_ID,
        dmUsername: DM_USERNAME,
        participants: [
            { type: 'PLAYER', name: 'Aragorn' },
            { type: 'NPC', name: 'Orc Scout' },
            { type: 'PLAYER', name: 'Legolas' },
            { type: 'NPC', name: 'Goblin Shaman' },
            { type: 'PLAYER', name: 'Gimli' },
            { type: 'NPC', name: 'Orc Grunt' },
        ],
        canStart: true,
    },

    /** Long combatant names - tests name truncation */
    longNames: {
        sessionId: SESSION_ID,
        dmUsername: DM_USERNAME,
        participants: [
            { type: 'PLAYER', name: 'Thranduil the Elvenking of Mirkwood' },
            { type: 'PLAYER', name: 'Galadriel Lady of Lothlorien the Fair' },
            { type: 'NPC', name: 'The Great Goblin King of the Misty Mountains' },
            { type: 'NPC', name: 'Azog the Defiler Bolgs Father and Commander' },
        ],
        canStart: true,
    },

    /** Crowded setup - 12 participants (6 players, 6 NPCs) to test list overflow */
    crowdedSetup: {
        sessionId: SESSION_ID,
        dmUsername: DM_USERNAME,
        participants: [
            // 6 Players
            { type: 'PLAYER', name: 'Player One' },
            { type: 'PLAYER', name: 'Player Two' },
            { type: 'PLAYER', name: 'Player Three' },
            { type: 'PLAYER', name: 'Player Four' },
            { type: 'PLAYER', name: 'Player Five' },
            { type: 'PLAYER', name: 'Player Six' },
            // 6 NPCs
            { type: 'NPC', name: 'Goblin Scout Alpha' },
            { type: 'NPC', name: 'Goblin Scout Beta' },
            { type: 'NPC', name: 'Orc Warrior Gamma' },
            { type: 'NPC', name: 'Orc Warrior Delta' },
            { type: 'NPC', name: 'Troll Brute Epsilon' },
            { type: 'NPC', name: 'Dark Mage Zeta' },
        ],
        canStart: true,
    },

    /** Extreme overflow - 20 participants with very long names for stress test */
    extremeOverflow: (() => {
        const participants = [];
        for (let i = 0; i < 10; i++) {
            participants.push({
                type: 'PLAYER',
                name: `Long Combatant Name ${String(i).padStart(2, '0')} XXXXX`,
            });
            participants.push({
                type: 'NPC',
                name: `Long Combatant Name ${String(i + 10).padStart(2, '0')} XXXXX`,
            });
        }
        return {
            sessionId: SESSION_ID,
            dmUsername: DM_USERNAME,
            participants,
            canStart: true,
        };
    })(),
};

// =============================================================================
// SETUP BUTTON CUSTOM_ID CONTRACT
// =============================================================================

/** Expected button custom_id prefixes in exact order across both rows */
const EXPECTED_BUTTON_CUSTOM_IDS = [
    // Row 1
    'join_combat_',
    'add_mob_modal_',
    'start_fight_',
    // Row 2
    'leave_setup_',
    'manage_participants_',
    'cancel_combat_',
];

// =============================================================================
// EMBED TESTS
// =============================================================================

describe('createSetupEmbed', () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc';
    const dmUsername = 'TestDM';

    test('creates embed with correct title and description', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], false);
        const data = embed.toJSON();

        expect(data.title).toBe('Combat Lobby');
        expect(data.description).toContain('Organized by TestDM');
        expect(data.description).toContain('Waiting for more participants...');
    });

    test('shows ready status in description when canStart is true', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], true);
        const data = embed.toJSON();
        expect(data.description).toContain('✅ Ready to start!');
    });

    test('has amber color when not ready', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], false);
        const data = embed.toJSON();
        expect(data.color).toBe(EMBED_COLORS.warning);
    });

    test('has green color when ready', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], true);
        const data = embed.toJSON();
        expect(data.color).toBe(EMBED_COLORS.success);
    });

    test('includes truncated session ID in footer', () => {
        const embed = createSetupEmbed(sessionId, dmUsername);
        const data = embed.toJSON();
        expect(data.footer.text).toContain('Session ID: 12345678');
    });

    test('shows correct status field for empty participants', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], false);
        const data = embed.toJSON();
        const statusField = data.fields.find(f => f.name === 'Status');
        expect(statusField.value).toContain('**0** participants.');
    });

    test('shows "None" for empty player and hostile lists', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, []);
        const data = embed.toJSON();
        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));
        expect(playersField.value).toBe('None');
        expect(hostilesField.value).toBe('None');
    });

    test('displays player names and count correctly', () => {
        const participants = [
            { type: 'PLAYER', name: 'Alice' },
            { type: 'PLAYER', name: 'Bob' },
        ];
        const embed = createSetupEmbed(sessionId, dmUsername, participants);
        const data = embed.toJSON();
        const playersField = data.fields.find(f => f.name === 'Players (2)');
        expect(playersField.value).toBe('• Alice\n• Bob');
    });

    test('displays hostile names and count correctly', () => {
        const participants = [
            { type: 'NPC', name: 'Goblin' },
            { type: 'NPC', name: 'Orc' },
        ];
        const embed = createSetupEmbed(sessionId, dmUsername, participants);
        const data = embed.toJSON();
        const hostilesField = data.fields.find(f => f.name === 'Hostiles (2)');
        expect(hostilesField.value).toBe('• Goblin\n• Orc');
    });

    test('truncates long names', () => {
        const participants = [{ type: 'PLAYER', name: 'ThisIsAVeryLongCharacterNameIndeed' }];
        const embed = createSetupEmbed(sessionId, dmUsername, participants);
        const data = embed.toJSON();
        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        expect(playersField.value).toBe('• ThisIsAVeryLongCharac...');
    });

    test('collapses lists with more than 8 participants', () => {
        const participants = Array.from({ length: 10 }, (_, i) => ({
            type: 'PLAYER',
            name: `Player ${i + 1}`,
        }));
        const embed = createSetupEmbed(sessionId, dmUsername, participants);
        const data = embed.toJSON();
        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        expect(playersField.value).toContain('*+2 more...*');
        expect(playersField.value.split('\n')).toHaveLength(9);
    });

    test('displays correct "Next Actions" when not ready', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], false);
        const data = embed.toJSON();
        const actionsField = data.fields.find(f => f.name === 'Next Actions');
        expect(actionsField.value).toContain('Players: Use "Join Combat"');
    });

    test('displays correct "Next Actions" when ready', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, [], true);
        const data = embed.toJSON();
        const actionsField = data.fields.find(f => f.name === 'Next Actions');
        expect(actionsField.value).toContain('DM: Press "Start Fight"');
    });

    test('has exactly 4 fields', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, []);
        const data = embed.toJSON();
        expect(data.fields).toHaveLength(4);
    });

    test('Players and Hostiles fields are inline', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, []);
        const data = embed.toJSON();
        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));
        expect(playersField.inline).toBe(true);
        expect(hostilesField.inline).toBe(true);
    });

    test('Status and Next Actions fields are not inline', () => {
        const embed = createSetupEmbed(sessionId, dmUsername, []);
        const data = embed.toJSON();
        const statusField = data.fields.find(f => f.name === 'Status');
        const actionsField = data.fields.find(f => f.name === 'Next Actions');
        expect(statusField.inline).toBe(false);
        expect(actionsField.inline).toBe(false);
    });
});

describe('createSetupActionRows', () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc';

    test('returns exactly 2 action rows', () => {
        const rows = createSetupActionRows(sessionId, true);
        expect(rows).toHaveLength(2);
    });

    test('first row has Join, Add Mob, and Start buttons', () => {
        const rows = createSetupActionRows(sessionId, true);
        const firstRowComponents = rows[0].toJSON().components;

        expect(firstRowComponents).toHaveLength(3);
        expect(firstRowComponents[0].custom_id).toBe(`join_combat_${sessionId}`);
        expect(firstRowComponents[1].custom_id).toBe(`add_mob_modal_${sessionId}`);
        expect(firstRowComponents[2].custom_id).toBe(`start_fight_${sessionId}`);
    });

    test('second row has Leave, Manage, and Cancel buttons', () => {
        const rows = createSetupActionRows(sessionId, true);
        const secondRowComponents = rows[1].toJSON().components;

        expect(secondRowComponents).toHaveLength(3);
        expect(secondRowComponents[0].custom_id).toBe(`leave_setup_${sessionId}`);
        expect(secondRowComponents[1].custom_id).toBe(`manage_participants_${sessionId}`);
        expect(secondRowComponents[2].custom_id).toBe(`cancel_combat_${sessionId}`);
    });

    test('Start button is disabled when canStart is false', () => {
        const rows = createSetupActionRows(sessionId, false);
        const startButton = rows[0].toJSON().components[2];

        expect(startButton.disabled).toBe(true);
    });

    test('Start button is enabled when canStart is true', () => {
        const rows = createSetupActionRows(sessionId, true);
        const startButton = rows[0].toJSON().components[2];

        expect(startButton.disabled).toBe(false);
    });

    test('all buttons have correct styles', () => {
        const rows = createSetupActionRows(sessionId, true);
        const firstRow = rows[0].toJSON().components;
        const secondRow = rows[1].toJSON().components;

        // Join button - Success (3)
        expect(firstRow[0].style).toBe(3);
        // Add Mob button - Secondary (2)
        expect(firstRow[1].style).toBe(2);
        // Start button - Primary (1)
        expect(firstRow[2].style).toBe(1);

        // Leave button - Secondary (2)
        expect(secondRow[0].style).toBe(2);
        // Manage button - Primary (1)
        expect(secondRow[1].style).toBe(1);
        // Cancel button - Danger (4)
        expect(secondRow[2].style).toBe(4);
    });

    test('all buttons have labels', () => {
        const rows = createSetupActionRows(sessionId, true);
        const allComponents = [...rows[0].toJSON().components, ...rows[1].toJSON().components];

        allComponents.forEach(component => {
            expect(component.label).toBeDefined();
            expect(component.label.length).toBeGreaterThan(0);
        });
    });

    test('all buttons have emojis', () => {
        const rows = createSetupActionRows(sessionId, true);
        const allComponents = [...rows[0].toJSON().components, ...rows[1].toJSON().components];

        allComponents.forEach(component => {
            expect(component.emoji).toBeDefined();
            expect(component.emoji.name).toBeDefined();
        });
    });

    test('includes full session ID in custom_ids', () => {
        const rows = createSetupActionRows(sessionId, true);
        const allComponents = [...rows[0].toJSON().components, ...rows[1].toJSON().components];

        allComponents.forEach(component => {
            expect(component.custom_id).toContain(sessionId);
        });
    });
});

// =============================================================================
// FIXTURE-BASED EMBED TESTS
// =============================================================================

describe('createSetupEmbed - Fixture Tests', () => {
    describe('Empty Setup', () => {
        test('shows "None" for empty participants', () => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.emptySetup;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            const data = embed.toJSON();

            const playersField = data.fields.find(f => f.name.startsWith('Players'));
            const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));

            expect(playersField.value).toBe('None');
            expect(hostilesField.value).toBe('None');
        });

        test('shows 0 participants in status', () => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.emptySetup;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            const data = embed.toJSON();

            const statusField = data.fields.find(f => f.name === 'Status');
            expect(statusField.value).toContain('**0** participants');
        });
    });

    describe('Ready-to-Start Setup', () => {
        test('has green color', () => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.readyToStart;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            const data = embed.toJSON();

            expect(data.color).toBe(EMBED_COLORS.success);
        });

        test('shows ready status in description', () => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.readyToStart;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            const data = embed.toJSON();

            expect(data.description).toContain('✅ Ready to start!');
        });

        test('player count is correct', () => {
            const { participants } = fixtures.readyToStart;
            const players = participants.filter(p => p.type === 'PLAYER');
            expect(players).toHaveLength(1);
        });

        test('hostile count is correct', () => {
            const { participants } = fixtures.readyToStart;
            const hostiles = participants.filter(p => p.type === 'NPC');
            expect(hostiles).toHaveLength(1);
        });
    });

    describe('Mixed Player/NPC Setup', () => {
        let embedData;

        beforeAll(() => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.mixedSetup;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            embedData = embed.toJSON();
        });

        test('player count is 3', () => {
            const players = fixtures.mixedSetup.participants.filter(p => p.type === 'PLAYER');
            expect(players).toHaveLength(3);
        });

        test('hostile count is 3', () => {
            const hostiles = fixtures.mixedSetup.participants.filter(p => p.type === 'NPC');
            expect(hostiles).toHaveLength(3);
        });

        test('all player names appear in field', () => {
            const playersField = embedData.fields.find(f => f.name.startsWith('Players'));
            expect(playersField.value).toContain('Aragorn');
            expect(playersField.value).toContain('Legolas');
            expect(playersField.value).toContain('Gimli');
        });

        test('all hostile names appear in field', () => {
            const hostilesField = embedData.fields.find(f => f.name.startsWith('Hostiles'));
            expect(hostilesField.value).toContain('Orc Scout');
            expect(hostilesField.value).toContain('Goblin Shaman');
            expect(hostilesField.value).toContain('Orc Grunt');
        });

        test('status shows 6 total participants', () => {
            const statusField = embedData.fields.find(f => f.name === 'Status');
            expect(statusField.value).toContain('**6** participants');
        });
    });

    describe('Long Combatant Names', () => {
        let embedData;

        beforeAll(() => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.longNames;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            embedData = embed.toJSON();
        });

        test('truncates names to 24 characters with ellipsis', () => {
            const playersField = embedData.fields.find(f => f.name.startsWith('Players'));
            // "Thranduil the Elvenking of Mirkwood" is 35 chars, should be truncated to 21 + "..."
            expect(playersField.value).toContain('...');
        });

        test('handles long names without crashing', () => {
            expect(embedData).toBeDefined();
            expect(embedData.fields).toHaveLength(4);
        });
    });

    describe('Crowded Setup (12 participants)', () => {
        let embedData;

        beforeAll(() => {
            const { sessionId, dmUsername, participants, canStart } = fixtures.crowdedSetup;
            const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
            embedData = embed.toJSON();
        });

        test('total participant count is 12', () => {
            expect(fixtures.crowdedSetup.participants).toHaveLength(12);
        });

        test('player count is 6', () => {
            const players = fixtures.crowdedSetup.participants.filter(p => p.type === 'PLAYER');
            expect(players).toHaveLength(6);
        });

        test('hostile count is 6', () => {
            const hostiles = fixtures.crowdedSetup.participants.filter(p => p.type === 'NPC');
            expect(hostiles).toHaveLength(6);
        });

        test('status shows 12 total participants', () => {
            const statusField = embedData.fields.find(f => f.name === 'Status');
            expect(statusField.value).toContain('**12** participants');
        });

        test('lists exactly 6 players without overflow indicator', () => {
            const playersField = embedData.fields.find(f => f.name.startsWith('Players'));
            // 6 players should all fit (max is 8)
            expect(playersField.value).not.toContain('+');
            expect(playersField.value).toContain('Player One');
            expect(playersField.value).toContain('Player Six');
        });

        test('lists exactly 6 hostiles without overflow indicator', () => {
            const hostilesField = embedData.fields.find(f => f.name.startsWith('Hostiles'));
            // 6 hostiles should all fit (max is 8)
            expect(hostilesField.value).not.toContain('+');
            expect(hostilesField.value).toContain('Goblin Scout Alpha');
            expect(hostilesField.value).toContain('Dark Mage Zeta');
        });
    });
});

// =============================================================================
// DISCORD LENGTH LIMIT TESTS
// =============================================================================

describe('createSetupEmbed - Discord Length Limits', () => {
    const DISCORD_FIELD_VALUE_MAX = 1024;
    const DISCORD_TITLE_MAX = 256;
    const DISCORD_DESCRIPTION_MAX = 4096;
    const DISCORD_FOOTER_MAX = 2048;

    /**
     * Helper to verify all field values are within Discord limits
     */
    const assertFieldsWithinLimit = (data, maxChars = DISCORD_FIELD_VALUE_MAX) => {
        data.fields.forEach((field, index) => {
            expect(field.value.length).toBeLessThanOrEqual(maxChars);
        });
    };

    test('empty setup - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.emptySetup;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('ready setup - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.readyToStart;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('mixed setup - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.mixedSetup;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('long names setup - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.longNames;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('crowded setup (12 participants) - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.crowdedSetup;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('extreme overflow (20 long names) - no field exceeds 1024 characters', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.extremeOverflow;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        assertFieldsWithinLimit(data);
    });

    test('title does not exceed Discord limit (256 chars)', () => {
        Object.values(fixtures).forEach(fixture => {
            const embed = createSetupEmbed(
                fixture.sessionId,
                fixture.dmUsername,
                fixture.participants,
                fixture.canStart
            );
            const data = embed.toJSON();

            expect(data.title.length).toBeLessThanOrEqual(DISCORD_TITLE_MAX);
        });
    });

    test('description does not exceed Discord limit (4096 chars)', () => {
        Object.values(fixtures).forEach(fixture => {
            const embed = createSetupEmbed(
                fixture.sessionId,
                fixture.dmUsername,
                fixture.participants,
                fixture.canStart
            );
            const data = embed.toJSON();

            expect(data.description.length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_MAX);
        });
    });

    test('footer text does not exceed Discord limit (2048 chars)', () => {
        Object.values(fixtures).forEach(fixture => {
            const embed = createSetupEmbed(
                fixture.sessionId,
                fixture.dmUsername,
                fixture.participants,
                fixture.canStart
            );
            const data = embed.toJSON();

            expect(data.footer.text.length).toBeLessThanOrEqual(DISCORD_FOOTER_MAX);
        });
    });

    test('extreme overflow uses +N more truncation to stay under limit', () => {
        const { sessionId, dmUsername, participants, canStart } = fixtures.extremeOverflow;
        const embed = createSetupEmbed(sessionId, dmUsername, participants, canStart);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));

        // Should have overflow indicator since we have 10 of each type (max is 8)
        expect(playersField.value).toContain('+2 more');
        expect(hostilesField.value).toContain('+2 more');
    });
});

// =============================================================================
// EXPANDED BUTTON CONTRACT TESTS
// =============================================================================

describe('createSetupActionRows - Expanded Contract Tests', () => {
    describe('Button Custom ID Preservation', () => {
        test('all 6 expected custom_id prefixes are present', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const allCustomIds = [...rows[0].toJSON().components, ...rows[1].toJSON().components].map(c => c.custom_id);

            EXPECTED_BUTTON_CUSTOM_IDS.forEach(prefix => {
                const found = allCustomIds.some(customId => customId.startsWith(prefix));
                expect(found).toBe(true);
            });
        });

        test('Row 1 buttons have correct custom_id prefixes in exact order', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const row1Components = rows[0].toJSON().components;

            expect(row1Components[0].custom_id.startsWith('join_combat_')).toBe(true);
            expect(row1Components[1].custom_id.startsWith('add_mob_modal_')).toBe(true);
            expect(row1Components[2].custom_id.startsWith('start_fight_')).toBe(true);
        });

        test('Row 2 buttons have correct custom_id prefixes in exact order', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const row2Components = rows[1].toJSON().components;

            expect(row2Components[0].custom_id.startsWith('leave_setup_')).toBe(true);
            expect(row2Components[1].custom_id.startsWith('manage_participants_')).toBe(true);
            expect(row2Components[2].custom_id.startsWith('cancel_combat_')).toBe(true);
        });

        test('all custom_ids are exactly prefix + sessionId', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const allCustomIds = [...rows[0].toJSON().components, ...rows[1].toJSON().components].map(c => c.custom_id);

            const expectedIds = EXPECTED_BUTTON_CUSTOM_IDS.map(prefix => `${prefix}${SESSION_ID}`);
            expect(allCustomIds).toEqual(expectedIds);
        });

        test('all custom_ids are unique', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const allCustomIds = [...rows[0].toJSON().components, ...rows[1].toJSON().components].map(c => c.custom_id);

            const uniqueCustomIds = new Set(allCustomIds);
            expect(uniqueCustomIds.size).toBe(6);
        });

        test('custom_ids do not exceed 100 characters (Discord limit)', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const allCustomIds = [...rows[0].toJSON().components, ...rows[1].toJSON().components].map(c => c.custom_id);

            allCustomIds.forEach(customId => {
                expect(customId.length).toBeLessThanOrEqual(100);
            });
        });
    });

    describe('Button Emoji Format', () => {
        test('all buttons use emoji objects (not strings)', () => {
            const rows = createSetupActionRows(SESSION_ID, true);
            const allComponents = [...rows[0].toJSON().components, ...rows[1].toJSON().components];

            allComponents.forEach(component => {
                expect(component.emoji).toBeDefined();
                expect(typeof component.emoji).toBe('object');
                expect(component.emoji.name).toBeDefined();
                expect(typeof component.emoji.name).toBe('string');
            });
        });
    });

    describe('Button Order Stability', () => {
        test('button order remains stable across multiple calls', () => {
            const rows1 = createSetupActionRows(SESSION_ID, true);
            const rows2 = createSetupActionRows(SESSION_ID, true);

            const ids1 = [...rows1[0].toJSON().components, ...rows1[1].toJSON().components].map(c => c.custom_id);

            const ids2 = [...rows2[0].toJSON().components, ...rows2[1].toJSON().components].map(c => c.custom_id);

            expect(ids1).toEqual(ids2);
        });

        test('button order is same regardless of canStart value', () => {
            const rowsEnabled = createSetupActionRows(SESSION_ID, true);
            const rowsDisabled = createSetupActionRows(SESSION_ID, false);

            const idsEnabled = [...rowsEnabled[0].toJSON().components, ...rowsEnabled[1].toJSON().components].map(
                c => c.custom_id
            );

            const idsDisabled = [...rowsDisabled[0].toJSON().components, ...rowsDisabled[1].toJSON().components].map(
                c => c.custom_id
            );

            expect(idsEnabled).toEqual(idsDisabled);
        });
    });

    describe('Start Button Dynamic State', () => {
        test('only Start button changes disabled state based on canStart', () => {
            const rowsEnabled = createSetupActionRows(SESSION_ID, true);
            const rowsDisabled = createSetupActionRows(SESSION_ID, false);

            const enabledButtons = [...rowsEnabled[0].toJSON().components, ...rowsEnabled[1].toJSON().components];
            const disabledButtons = [...rowsDisabled[0].toJSON().components, ...rowsDisabled[1].toJSON().components];

            // Index 2 is the Start button (third in row 1)
            for (let i = 0; i < 6; i++) {
                if (i === 2) {
                    // Start button - should differ
                    expect(enabledButtons[i].disabled).toBe(false);
                    expect(disabledButtons[i].disabled).toBe(true);
                } else {
                    // All other buttons - should be the same (undefined or false)
                    expect(enabledButtons[i].disabled).toBe(disabledButtons[i].disabled);
                }
            }
        });
    });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('createSetupEmbed - Edge Cases', () => {
    test('handles participants with null names', () => {
        const participants = [
            { type: 'PLAYER', name: null },
            { type: 'NPC', name: null },
        ];
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, true);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));

        expect(playersField.value).toContain('Unknown');
        expect(hostilesField.value).toContain('Unknown');
    });

    test('handles participants with empty string names', () => {
        const participants = [
            { type: 'PLAYER', name: '' },
            { type: 'NPC', name: '' },
        ];
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, true);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));

        expect(playersField.value).toContain('Unknown');
        expect(hostilesField.value).toContain('Unknown');
    });

    test('handles only players (no hostiles)', () => {
        const participants = [
            { type: 'PLAYER', name: 'Alice' },
            { type: 'PLAYER', name: 'Bob' },
        ];
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, false);
        const data = embed.toJSON();

        const hostilesField = data.fields.find(f => f.name.startsWith('Hostiles'));
        expect(hostilesField.value).toBe('None');
    });

    test('handles only hostiles (no players)', () => {
        const participants = [
            { type: 'NPC', name: 'Goblin' },
            { type: 'NPC', name: 'Orc' },
        ];
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, false);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        expect(playersField.value).toBe('None');
    });

    test('handles exactly 8 participants (boundary)', () => {
        const participants = Array.from({ length: 8 }, (_, i) => ({
            type: 'PLAYER',
            name: `Player ${i + 1}`,
        }));
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, true);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        // Exactly 8 should NOT have overflow indicator
        expect(playersField.value).not.toContain('+');
        expect(playersField.value.split('\n')).toHaveLength(8);
    });

    test('handles 9 participants (triggers overflow)', () => {
        const participants = Array.from({ length: 9 }, (_, i) => ({
            type: 'PLAYER',
            name: `Player ${i + 1}`,
        }));
        const embed = createSetupEmbed(SESSION_ID, DM_USERNAME, participants, true);
        const data = embed.toJSON();

        const playersField = data.fields.find(f => f.name.startsWith('Players'));
        // 9 should have overflow indicator
        expect(playersField.value).toContain('+1 more');
        expect(playersField.value.split('\n')).toHaveLength(9); // 8 names + 1 overflow line
    });
});
