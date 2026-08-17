import 'dotenv/config';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';
import { closeDb } from '../../db';

const app = createApiApp({ resolveCtx: async () => ({ discordId: 'test-rules' }) });

describe('rules API', () => {
    after(async () => {
        await closeDb();
    });

    it('GET /rules/search → 200 with the hybrid-search shape (selectedPage + two arrays)', async () => {
        const r = await app.request('/rules/search?q=Drache');
        assert.equal(r.status, 200);
        const body = await r.json();
        // selectedPage is null when no results (e.g. empty KB / no API key); arrays always present.
        assert.ok(body.selectedPage === null || typeof body.selectedPage === 'object');
        assert.ok(Array.isArray(body.exactMatches));
        assert.ok(Array.isArray(body.semanticMatches));
    });

    it('GET /rules/search without q → 400', async () => {
        const r = await app.request('/rules/search');
        assert.equal(r.status, 400);
    });

    it('GET /rules/pages/:doc_id unknown → 404', async () => {
        const r = await app.request('/rules/pages/does-not-exist-doc-id');
        assert.equal(r.status, 404);
    });
});
