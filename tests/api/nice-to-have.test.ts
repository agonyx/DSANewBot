import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createApiApp } from '../../api';
import { closeDb, db } from '../../db';
import { diceMacros, players } from '../../db/schema';

const OWNER_ID = `test-nice-owner-${Date.now()}`;
const OTHER_ID = `test-nice-other-${Date.now()}`;
const ownerApp = createApiApp({ resolveCtx: () => ({ discordId: OWNER_ID }) });
const otherApp = createApiApp({ resolveCtx: () => ({ discordId: OTHER_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('character export and dice macro APIs (live DB)', () => {
    let ownerPlayerId: number;
    let otherPlayerId: number;

    after(async () => {
        await db.delete(players).where(eq(players.discord_id, OWNER_ID));
        await db.delete(players).where(eq(players.discord_id, OTHER_ID));
        await closeDb();
    });

    it('creates and selects isolated characters for both callers', async () => {
        const owner = await (await ownerApp.request('/characters', json('POST', { name: 'Export Hero' }))).json();
        ownerPlayerId = owner.player.id;
        assert.equal((await ownerApp.request(`/characters/${ownerPlayerId}/select`, { method: 'POST' })).status, 200);

        const other = await (await otherApp.request('/characters', json('POST', { name: 'Other Hero' }))).json();
        otherPlayerId = other.player.id;
        assert.equal((await otherApp.request(`/characters/${otherPlayerId}/select`, { method: 'POST' })).status, 200);
    });

    it('exports only the caller-selected character as a UTF-8 attachment', async () => {
        const res = await ownerApp.request('/characters/me/export');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /^text\/plain; charset=UTF-8$/i);
        assert.equal(res.headers.get('content-disposition'), 'attachment; filename="export-hero-character-sheet.txt"');

        const text = await res.text();
        assert.match(text, /^DSA5 CHARACTER SHEET/m);
        assert.match(text, /^Name: Export Hero$/m);
        assert.doesNotMatch(text, /Other Hero/);
        assert.match(text, /^Attributes$/m);
        assert.match(text, /^Combat$/m);
        assert.match(text, /^Wallet$/m);
    });

    it('rejects malformed dice macro names and unsafe notation', async () => {
        const invalidName = await ownerApp.request(
            '/dice-macros',
            json('POST', { name: '../damage', notation: '2w6+3' })
        );
        assert.equal(invalidName.status, 400);

        const invalidNotation = await ownerApp.request(
            '/dice-macros',
            json('POST', { name: 'damage', notation: '101w6' })
        );
        assert.equal(invalidNotation.status, 400);
    });

    it('saves, updates, lists, and rolls a per-character dice macro', async () => {
        const created = await (
            await ownerApp.request('/dice-macros', json('POST', { name: ' DAMAGE ', notation: '2d6 + 3' }))
        ).json();
        assert.equal(created.created, true);
        assert.equal(created.macro.name, 'damage');
        assert.equal(created.macro.notation, '2w6+3');

        const updated = await (
            await ownerApp.request('/dice-macros', json('POST', { name: 'damage', notation: '1w20-2' }))
        ).json();
        assert.equal(updated.created, false);
        assert.equal(updated.macro.notation, '1w20-2');

        const list = await (await ownerApp.request('/dice-macros')).json();
        assert.deepEqual(
            list.map((macro: { name: string; notation: string }) => [macro.name, macro.notation]),
            [['damage', '1w20-2']]
        );

        const rolled = await (await ownerApp.request('/dice-macros/damage/roll', { method: 'POST' })).json();
        assert.equal(rolled.characterName, 'Export Hero');
        assert.equal(rolled.roll.notation, '1w20-2');
        assert.equal(rolled.roll.rolls.length, 1);
        assert.ok(rolled.roll.rolls[0] >= 1 && rolled.roll.rolls[0] <= 20);
        assert.equal(rolled.roll.total, rolled.roll.rolls[0] - 2);
    });

    it('keeps macros isolated by selected character and owner', async () => {
        const missing = await otherApp.request('/dice-macros/damage/roll', { method: 'POST' });
        assert.equal(missing.status, 404);

        const otherMacro = await (
            await otherApp.request('/dice-macros', json('POST', { name: 'damage', notation: '1w6' }))
        ).json();
        assert.equal(otherMacro.macro.player_id, otherPlayerId);

        const [ownerMacro] = await db.select().from(diceMacros).where(eq(diceMacros.player_id, ownerPlayerId)).limit(1);
        assert.equal(ownerMacro.notation, '1w20-2');
    });

    it('deletes only the caller-owned macro', async () => {
        const deleted = await ownerApp.request('/dice-macros/damage', { method: 'DELETE' });
        assert.equal(deleted.status, 200);
        assert.equal((await ownerApp.request('/dice-macros/damage/roll', { method: 'POST' })).status, 404);

        const otherList = await (await otherApp.request('/dice-macros')).json();
        assert.equal(otherList.length, 1);
        assert.equal(otherList[0].notation, '1w6');
    });
});
