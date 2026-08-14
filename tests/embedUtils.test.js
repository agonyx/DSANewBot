const {
    EMBED_COLORS,
    buildListEmbeds,
    buildSectionEmbeds,
    chunkLines,
    createEmbed,
    formatStructuredLines,
    makeFooter,
    progressBar,
    truncateText,
} = require('../utils/embedUtils');

describe('embedUtils', () => {
    test('creates embeds from the semantic color palette', () => {
        expect(createEmbed('success').toJSON().color).toBe(EMBED_COLORS.success);
        expect(createEmbed('unknown').toJSON().color).toBe(EMBED_COLORS.neutral);
    });

    test('truncates at a readable boundary and preserves the limit', () => {
        const result = truncateText('one two three four', 13);
        expect(result).toBe('one two…');
        expect(result.length).toBeLessThanOrEqual(13);
    });

    test('chunks lines without exceeding a Discord description', () => {
        const chunks = chunkLines(['alpha', 'beta', 'gamma'], 10);
        expect(chunks).toEqual(['alpha\nbeta', 'gamma']);
        expect(chunks.every(chunk => chunk.length <= 10)).toBe(true);
    });

    test('builds numbered list pages without silently dropping normal results', () => {
        const embeds = buildListEmbeds({
            title: 'Catalog',
            lines: Array.from({ length: 12 }, (_, index) => `Entry ${index + 1}`),
            maxDescriptionLength: 30,
        });
        const json = embeds.map(embed => embed.toJSON());
        const output = json.map(embed => embed.description).join('\n');

        expect(embeds.length).toBeGreaterThan(1);
        expect(json[0].title).toMatch(/1\/\d+$/);
        expect(output).toContain('Entry 1');
        expect(output).toContain('Entry 12');
        expect(json.every(embed => embed.description.length <= 4096)).toBe(true);
    });

    test('splits long section values into valid Discord fields', () => {
        const embeds = buildSectionEmbeds({
            title: 'Inventory',
            sections: [{ name: 'Gear', lines: Array.from({ length: 180 }, (_, index) => `Item ${index}`) }],
        });
        const fields = embeds.flatMap(embed => embed.toJSON().fields || []);

        expect(fields.length).toBeGreaterThan(1);
        expect(fields.every(field => field.name.length <= 256)).toBe(true);
        expect(fields.every(field => field.value.length <= 1024)).toBe(true);
    });

    test('reports section overflow instead of silently hiding it', () => {
        const embeds = buildSectionEmbeds({
            title: 'Large catalog',
            sections: Array.from({ length: 260 }, (_, index) => ({ name: `Group ${index}`, lines: ['Entry'] })),
        });

        expect(embeds).toHaveLength(10);
        expect(embeds.at(-1).toJSON().description).toContain('Additional sections were omitted');
    });

    test('formats structured mechanics for people instead of exposing JSON', () => {
        expect(
            formatStructuredLines({ at_modifier: -2, techniques: ['Dolche', 'Fechtwaffen'], hands_free: 2 })
        ).toEqual(['**AT Modifier:** -2', '**Techniques:** Dolche, Fechtwaffen', '**Hands Free:** 2']);
    });

    test('clamps progress bars and builds safe user footers', () => {
        expect(progressBar(12, 10, 5)).toBe('■■■■■');
        expect(progressBar(-1, 10, 5)).toBe('□□□□□');
        expect(makeFooter({ username: 'Arbosch', avatarURL: () => 'https://example.test/avatar.png' })).toEqual({
            text: 'Requested by Arbosch',
            iconURL: 'https://example.test/avatar.png',
        });
    });
});
