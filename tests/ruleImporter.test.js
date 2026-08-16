const { parseArgs, resolveBackend } = require('../scripts/import-rules-v3');

describe('rule importer backend selection', () => {
    test('prefers direct Postgres when DATABASE_URL is configured', () => {
        expect(
            resolveBackend({
                DATABASE_URL: 'postgresql://example.invalid/db',
                SUPABASE_URL: 'https://example.invalid',
                SUPABASE_SERVICE_KEY: 'unused',
            })
        ).toBe('postgres');
    });

    test('keeps the legacy Supabase path as a fallback', () => {
        expect(
            resolveBackend({
                SUPABASE_URL: 'https://example.invalid',
                SUPABASE_SERVICE_KEY: 'test-key',
            })
        ).toBe('supabase');
    });

    test('rejects imports without a configured persistence backend', () => {
        expect(() => resolveBackend({})).toThrow('DATABASE_URL or SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    });
});

describe('rule importer arguments', () => {
    test('keeps resumable imports by default and allows an explicit re-embed', () => {
        expect(parseArgs([]).forceReembed).toBe(false);
        expect(parseArgs(['--force-reembed']).forceReembed).toBe(true);
    });
});
