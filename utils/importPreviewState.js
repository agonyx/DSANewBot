const DEFAULT_IMPORT_PREVIEW_TTL_MS = 10 * 60_000;

function importPreviewStore(client, now = Date.now()) {
    if (!client.characterImportPreviews) client.characterImportPreviews = new Map();
    for (const [id, preview] of client.characterImportPreviews) {
        if (preview.expiresAt <= now) client.characterImportPreviews.delete(id);
    }
    return client.characterImportPreviews;
}

function inspectImportPreview(client, id, userId, now = Date.now()) {
    const state = importPreviewStore(client, now).get(id);
    if (!state || state.expiresAt <= now) return { code: 'EXPIRED', state: null };
    if (state.userId !== userId) return { code: 'FORBIDDEN', state: null };
    return { code: 'OK', state };
}

function claimImportPreview(state) {
    if (state.status === 'COMPLETE') return 'COMPLETE';
    if (state.status === 'IMPORTING') return 'IMPORTING';
    if (state.status !== 'READY') return 'INACTIVE';
    state.status = 'IMPORTING';
    return 'CLAIMED';
}

function completeImportPreview(state, result, now = Date.now(), ttlMs = DEFAULT_IMPORT_PREVIEW_TTL_MS) {
    state.status = 'COMPLETE';
    state.result = result;
    state.expiresAt = now + ttlMs;
}

function releaseImportPreview(state) {
    if (state.status === 'IMPORTING') state.status = 'READY';
}

module.exports = {
    DEFAULT_IMPORT_PREVIEW_TTL_MS,
    importPreviewStore,
    inspectImportPreview,
    claimImportPreview,
    completeImportPreview,
    releaseImportPreview,
};
