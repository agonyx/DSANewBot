const {
    importPreviewStore,
    inspectImportPreview,
    claimImportPreview,
    completeImportPreview,
    releaseImportPreview,
} = require('../utils/importPreviewState');

describe('character import preview state', () => {
    test('expires previews and binds confirmation to the uploader', () => {
        const client = {};
        const store = importPreviewStore(client, 1_000);
        store.set('expired', { userId: 'owner', status: 'READY', expiresAt: 999 });
        store.set('active', { userId: 'owner', status: 'READY', expiresAt: 2_000 });

        expect(inspectImportPreview(client, 'expired', 'owner', 1_000).code).toBe('EXPIRED');
        expect(inspectImportPreview(client, 'active', 'stranger', 1_000).code).toBe('FORBIDDEN');
        expect(inspectImportPreview(client, 'active', 'owner', 1_000).code).toBe('OK');
    });

    test('claims once, retries after failure, and treats completion idempotently', () => {
        const state = { userId: 'owner', status: 'READY', result: null, expiresAt: 2_000 };
        expect(claimImportPreview(state)).toBe('CLAIMED');
        expect(claimImportPreview(state)).toBe('IMPORTING');

        releaseImportPreview(state);
        expect(claimImportPreview(state)).toBe('CLAIMED');
        const result = { player: { name: 'Arbosch' } };
        completeImportPreview(state, result, 5_000, 1_000);
        expect(state).toMatchObject({ status: 'COMPLETE', result, expiresAt: 6_000 });
        expect(claimImportPreview(state)).toBe('COMPLETE');
    });
});
