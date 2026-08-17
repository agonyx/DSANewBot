const { readJsonAttachment } = require('../utils/attachmentJson');

describe('Discord JSON attachment boundary', () => {
    test('downloads and parses a bounded Discord attachment', async () => {
        const fetchImpl = jest.fn(
            async () =>
                new Response(JSON.stringify({ format: 'ok' }), {
                    status: 200,
                    headers: { 'content-length': '15' },
                })
        );
        await expect(
            readJsonAttachment({ url: 'https://cdn.discordapp.com/attachments/1/2/file.json', size: 15 }, { fetchImpl })
        ).resolves.toEqual({ format: 'ok' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('rejects non-Discord hosts, oversized payloads, and malformed JSON', async () => {
        await expect(
            readJsonAttachment({ url: 'https://example.test/file.json', size: 10 }, { fetchImpl: jest.fn() })
        ).rejects.toThrow(/hosted by Discord/);
        await expect(
            readJsonAttachment(
                { url: 'https://cdn.discordapp.com/attachments/1/2/file.json', size: 2_000_000 },
                { fetchImpl: jest.fn() }
            )
        ).rejects.toThrow(/at most/);
        await expect(
            readJsonAttachment(
                { url: 'https://cdn.discordapp.com/attachments/1/2/file.json', size: 5 },
                { fetchImpl: jest.fn(async () => new Response('nope', { status: 200 })) }
            )
        ).rejects.toThrow(/valid JSON/);
    });
});
