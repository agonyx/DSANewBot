import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiApp } from '../../api';

const appFor = (discordId: string) => createApiApp({ resolveCtx: async () => ({ discordId }) });

describe('API foundation', () => {
    it('GET /health → 200 ok (public, no auth needed)', async () => {
        const res = await appFor('123').request('/health');
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { status: 'ok' });
    });

    it('GET /me with injected ctx → echoes the caller discordId', async () => {
        const res = await appFor('999').request('/me');
        assert.equal(res.status, 200);
        assert.equal((await res.json()).discordId, '999');
    });

    it('protected route with no token (real JWT auth) → 401', async () => {
        const res = await createApiApp().request('/me');
        assert.equal(res.status, 401);
    });
});
