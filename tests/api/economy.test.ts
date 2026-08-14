import 'dotenv/config';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createApiApp } from '../../api';
import { closeDb, db } from '../../db';
import { combatants, combatSessions, equipmentCatalog, items, players, stats } from '../../db/schema';

const OWNER_ID = `test-economy-owner-${Date.now()}`;
const RECIPIENT_ID = `test-economy-recipient-${Date.now()}`;
const ownerApp = createApiApp({ resolveCtx: () => ({ discordId: OWNER_ID }) });
const recipientApp = createApiApp({ resolveCtx: () => ({ discordId: RECIPIENT_ID }) });

const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

describe('economy, equipment, trade, and loot API (live DB)', () => {
    let ownerPlayerId: number;
    let recipientPlayerId: number;
    let armorCatalogId: string;
    let gearCatalogId: string;
    let sessionId: string;

    after(async () => {
        if (sessionId) await db.delete(combatSessions).where(eq(combatSessions.id, sessionId));
        await db.delete(players).where(eq(players.discord_id, OWNER_ID));
        await db.delete(players).where(eq(players.discord_id, RECIPIENT_ID));
        if (armorCatalogId) await db.delete(equipmentCatalog).where(eq(equipmentCatalog.id, armorCatalogId));
        if (gearCatalogId) await db.delete(equipmentCatalog).where(eq(equipmentCatalog.id, gearCatalogId));
        await closeDb();
    });

    it('sets up two selected characters and test catalog entries', async () => {
        const owner = await (await ownerApp.request('/characters', json('POST', { name: 'Merchant' }))).json();
        ownerPlayerId = owner.player.id;
        assert.equal((await ownerApp.request(`/characters/${ownerPlayerId}/select`, { method: 'POST' })).status, 200);
        const recipient = await (await recipientApp.request('/characters', json('POST', { name: 'Customer' }))).json();
        recipientPlayerId = recipient.player.id;
        assert.equal(
            (await recipientApp.request(`/characters/${recipientPlayerId}/select`, { method: 'POST' })).status,
            200
        );
        const [armor, gear] = await db
            .insert(equipmentCatalog)
            .values([
                {
                    external_id: `test-armor-${Date.now()}`,
                    name: 'Test Leather Armor',
                    category: 'ARMOR',
                    price_kreuzer: 1_000,
                    weight_grams: 5_000,
                    default_slot: 'BODY',
                    armor_rs: 3,
                    armor_be: 1,
                },
                {
                    external_id: `test-gear-${Date.now()}`,
                    name: 'Test Rope',
                    category: 'GEAR',
                    price_kreuzer: 500,
                    weight_grams: 4_000,
                },
            ])
            .returning();
        armorCatalogId = armor.id;
        gearCatalogId = gear.id;
    });

    it('records money, buys and equips armor, and derives RS/Belastung', async () => {
        assert.equal(
            (
                await ownerApp.request(
                    '/economy/wallet/adjust',
                    json('POST', { amountKreuzer: 5_000, reason: 'Test purse' })
                )
            ).status,
            200
        );
        const purchase = await (
            await ownerApp.request('/economy/shop/buy', json('POST', { catalogId: armorCatalogId }))
        ).json();
        const armorId = purchase.purchased[0].id;
        const equipped = await (
            await ownerApp.request(`/economy/equipment/items/${armorId}/equip`, json('POST', {}))
        ).json();
        assert.equal(equipped.state.armorSoak, 3);
        assert.equal(equipped.state.encumbrance, 1);
        const [sheet] = await db.select().from(stats).where(eq(stats.player_id, ownerPlayerId));
        assert.equal(sheet.ruestungsschutz, 3);
        assert.equal(sheet.belastung, 1);
    });

    it('accepts an atomic item-for-currency trade', async () => {
        await recipientApp.request(
            '/economy/wallet/adjust',
            json('POST', { amountKreuzer: 500, reason: 'Test purse' })
        );
        const purchase = await (
            await ownerApp.request('/economy/shop/buy', json('POST', { catalogId: gearCatalogId }))
        ).json();
        const gearId = purchase.purchased[0].id;
        const created = await (
            await ownerApp.request(
                '/economy/trades',
                json('POST', {
                    recipientDiscordId: RECIPIENT_ID,
                    requestedKreuzer: 100,
                    offeredAssets: [{ assetType: 'ITEM', assetId: gearId, quantity: 1 }],
                })
            )
        ).json();
        const accepted = await recipientApp.request(`/economy/trades/${created.trade.id}/accept`, {
            method: 'POST',
        });
        assert.equal(accepted.status, 200);
        const [transferred] = await db
            .select()
            .from(items)
            .where(and(eq(items.player_id, recipientPlayerId), eq(items.catalog_id, gearCatalogId)));
        assert.equal(transferred.quantity, 1);
        const ownerWallet = await (await ownerApp.request('/economy/wallet')).json();
        const recipientWallet = await (await recipientApp.request('/economy/wallet')).json();
        assert.equal(ownerWallet.balance.totalKreuzer, 3_600);
        assert.equal(recipientWallet.balance.totalKreuzer, 400);
    });

    it('restricts generation to the DM and awards a whole pool to a participant', async () => {
        const [session] = await db
            .insert(combatSessions)
            .values({ channel_id: `loot-${Date.now()}`, dm_user_id: OWNER_ID, state: 'ENDED' })
            .returning();
        sessionId = session.id;
        const ownerStats = await db.select().from(stats).where(eq(stats.player_id, ownerPlayerId)).limit(1);
        const recipientStats = await db.select().from(stats).where(eq(stats.player_id, recipientPlayerId)).limit(1);
        await db.insert(combatants).values([
            {
                session_id: session.id,
                type: 'PLAYER',
                allegiance: 'PLAYER_SIDE',
                player_id: ownerPlayerId,
                discord_user_id: OWNER_ID,
                name: 'Merchant',
                max_hp: ownerStats[0].le_max,
                current_hp: ownerStats[0].le_current,
            },
            {
                session_id: session.id,
                type: 'PLAYER',
                allegiance: 'PLAYER_SIDE',
                player_id: recipientPlayerId,
                discord_user_id: RECIPIENT_ID,
                name: 'Customer',
                max_hp: recipientStats[0].le_max,
                current_hp: recipientStats[0].le_current,
            },
        ]);
        assert.equal(
            (await recipientApp.request('/economy/loot', json('POST', { sessionId: session.id, tier: 1 }))).status,
            403
        );
        const generated = await (
            await ownerApp.request('/economy/loot', json('POST', { sessionId: session.id, tier: 1 }))
        ).json();
        const awarded = await (
            await ownerApp.request(
                `/economy/loot/${generated.pool.id}/award`,
                json('POST', {
                    targetDiscordId: RECIPIENT_ID,
                    currencyKreuzer: generated.pool.currency_remaining_kreuzer,
                    entryId: generated.entries[0].id,
                    quantity: generated.entries[0].quantity_remaining,
                })
            )
        ).json();
        assert.equal(awarded.pool.status, 'DISTRIBUTED');
    });
});
