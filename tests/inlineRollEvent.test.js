jest.mock('../utils/inlineRolls', () => ({
    resolveInlineRolls: jest.fn(content =>
        content.includes('[[1w20+3]]')
            ? { rolls: [{ expression: '1w20+3', result: { total: 13 }, error: null }], omitted: 0 }
            : { rolls: [], omitted: 0 }
    ),
    formatInlineRollReply: jest.fn(() => '🎲 **1W20+3** → [10] + 3 = **13**'),
}));

const { handleInlineRollMessage } = require('../events/inlineRolls');

describe('inline roll message event', () => {
    test('replies with a compact roll and disables reply pings', async () => {
        const message = {
            author: { bot: false },
            content: 'I attack [[1w20+3]].',
            reply: jest.fn().mockResolvedValue({ id: 'reply' }),
        };

        await handleInlineRollMessage(message, () => 10);

        expect(message.reply).toHaveBeenCalledWith({
            content: '🎲 **1W20+3** → [10] + 3 = **13**',
            allowedMentions: { repliedUser: false },
        });
    });

    test('ignores bots and messages without dice expressions', async () => {
        const botMessage = { author: { bot: true }, content: '[[1w20]]', reply: jest.fn() };
        const plainMessage = { author: { bot: false }, content: 'See [[Rules Index]].', reply: jest.fn() };

        await handleInlineRollMessage(botMessage, () => 10);
        await handleInlineRollMessage(plainMessage, () => 10);

        expect(botMessage.reply).not.toHaveBeenCalled();
        expect(plainMessage.reply).not.toHaveBeenCalled();
    });
});
