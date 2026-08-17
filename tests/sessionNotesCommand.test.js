const mockServices = {
    createSessionNote: jest.fn(),
    deleteSessionNote: jest.fn(),
    getSessionNote: jest.fn(),
    listSessionNotes: jest.fn(),
    updateSessionNote: jest.fn(),
};

jest.mock('../services/sessionNotes', () => mockServices);
jest.mock('../utils/embedViews', () => ({
    buildSessionNoteEmbed: jest.fn(() => ({ title: 'note' })),
    buildSessionNoteListEmbeds: jest.fn(() => [{ title: 'list' }]),
}));

const command = require('../commands/session-notes');

describe('/session-notes authorization and routing', () => {
    beforeEach(() => jest.clearAllMocks());

    test('rejects callers without Manage Server before touching storage', async () => {
        const interaction = {
            guildId: 'guild-1',
            memberPermissions: { has: jest.fn(() => false) },
            reply: jest.fn(),
        };

        await command.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: '❌ Session notes require Manage Server permission.',
            ephemeral: true,
        });
        expect(mockServices.listSessionNotes).not.toHaveBeenCalled();
    });

    test('lists only through a DM context scoped to the current guild', async () => {
        mockServices.listSessionNotes.mockResolvedValue([]);
        const interaction = {
            guildId: 'guild-1',
            user: { id: 'dm-1' },
            memberPermissions: { has: jest.fn(() => true) },
            options: {
                getSubcommand: () => 'list',
                getBoolean: () => false,
            },
            deferReply: jest.fn(),
            editReply: jest.fn(),
        };

        await command.execute(interaction);

        expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        expect(mockServices.listSessionNotes).toHaveBeenCalledWith({ discordId: 'dm-1', role: 'DM' }, 'guild-1');
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: [{ title: 'list' }] });
    });
});
