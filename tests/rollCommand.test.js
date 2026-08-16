const mockDispatchWebhookEvent = jest.fn();
const mockEmbed = {
    setTitle: jest.fn(),
    setDescription: jest.fn(),
    setFooter: jest.fn(),
    setTimestamp: jest.fn(),
};
for (const method of Object.keys(mockEmbed)) mockEmbed[method].mockReturnValue(mockEmbed);

jest.mock('../utils/rollUtil', () => ({ rollDice: jest.fn() }));
jest.mock('../utils/diceUtils', () => ({
    rollNotation: jest.fn(() => ({ notation: '2w6+3', count: 2, sides: 6, rolls: [2, 5], modifier: 3, total: 10 })),
}));
jest.mock('../utils/inlineRolls', () => ({ formatInlineRollResult: jest.fn(() => 'formatted roll') }));
jest.mock('../utils/embedUtils', () => ({
    createEmbed: jest.fn(() => mockEmbed),
    makeFooter: jest.fn(() => ({ text: 'Rolled by user' })),
}));
jest.mock('../services/webhooks', () => ({ dispatchWebhookEvent: mockDispatchWebhookEvent }));

const command = require('../commands/roll');

describe('/roll Dice So Nice integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const method of Object.keys(mockEmbed)) mockEmbed[method].mockReturnValue(mockEmbed);
    });

    test('publishes an animated roll as a Foundry-compatible signed webhook event', async () => {
        mockDispatchWebhookEvent.mockResolvedValue({ delivered: 1, failed: 0 });
        const values = { dice: '2w6+3', visible: true, animated: true };
        const interaction = {
            guildId: 'guild-1',
            user: { id: 'user-1' },
            options: {
                getString: name => values[name],
                getBoolean: name => values[name],
            },
            deferReply: jest.fn(),
            editReply: jest.fn(),
        };

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
        expect(mockDispatchWebhookEvent).toHaveBeenCalledWith('guild-1', 'dice.roll', {
            integration: 'foundry-dice-so-nice',
            formula: '2d6+3',
            notation: '2w6+3',
            rolls: [2, 5],
            modifier: 3,
            total: 10,
            userId: 'user-1',
            dsnData: {
                throws: [
                    {
                        dice: [
                            { result: 2, resultLabel: 2, type: 'd6', vectors: [], options: {} },
                            { result: 5, resultLabel: 5, type: 'd6', vectors: [], options: {} },
                        ],
                    },
                ],
            },
        });
        expect(mockEmbed.setDescription).toHaveBeenCalledWith(expect.stringContaining('1 delivered, 0 failed'));
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [mockEmbed] });
    });

    test('rejects animated rolls outside a guild', async () => {
        const interaction = {
            guildId: null,
            options: { getString: () => '1w20', getBoolean: name => name === 'animated' },
            reply: jest.fn(),
        };
        await command.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({
            content: '❌ Animated rolls require a server with a configured Dice So Nice webhook.',
            ephemeral: true,
        });
        expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
    });
});
