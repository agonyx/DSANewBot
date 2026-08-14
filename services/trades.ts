import { and, desc, eq, inArray, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { items, players, tradeItems, trades, weapons } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { getSelectedPlayer } from './characters';
import { changeWalletBalanceInTransaction, lockWalletsInTransaction } from './economy';
import { synchronizeEquipmentDerivedStatsInTransaction } from './equipment';
import type { Transaction } from './advancement';
import type { Ctx } from './_ctx';

export interface TradeAssetInput {
    assetType: 'ITEM' | 'WEAPON';
    assetId: number;
    quantity?: number;
}

function currency(value: number | undefined, name: string) {
    const amount = value ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_000_000_000) {
        throw httpError(400, `${name} must be a non-negative safe integer`);
    }
    return amount;
}

function quantity(value: number | undefined, assetType: string) {
    const amount = value ?? 1;
    if (!Number.isInteger(amount) || amount < 1 || amount > 100 || (assetType === 'WEAPON' && amount !== 1)) {
        throw httpError(400, assetType === 'WEAPON' ? 'Weapon quantity must be 1' : 'Quantity must be 1..100');
    }
    return amount;
}

async function loadAssetSnapshot(playerId: number, input: TradeAssetInput) {
    if (input.assetType !== 'ITEM' && input.assetType !== 'WEAPON') {
        throw httpError(400, 'assetType must be ITEM or WEAPON');
    }
    if (!Number.isInteger(input.assetId) || input.assetId < 1) {
        throw httpError(400, 'assetId must be a positive integer');
    }
    const amount = quantity(input.quantity, input.assetType);
    if (input.assetType === 'ITEM') {
        const [item] = await db
            .select()
            .from(items)
            .where(and(eq(items.id, input.assetId), eq(items.player_id, playerId)))
            .limit(1);
        if (!item) throw httpError(404, 'Trade item not found');
        if (item.is_equipped) throw httpError(409, `${item.name} must be unequipped before trading`);
        if (item.quantity < amount) throw httpError(409, `Only ${item.quantity} × ${item.name} are available`);
        return { assetType: input.assetType, assetId: input.assetId, quantity: amount, name: item.name };
    }
    const [weapon] = await db
        .select()
        .from(weapons)
        .where(and(eq(weapons.id, input.assetId), eq(weapons.player_id, playerId)))
        .limit(1);
    if (!weapon) throw httpError(404, 'Trade weapon not found');
    if (weapon.is_equipped === 'Y') throw httpError(409, `${weapon.name} must be unequipped before trading`);
    return { assetType: input.assetType, assetId: input.assetId, quantity: 1, name: weapon.name };
}

async function transferAsset(
    tx: Transaction,
    input: { sourcePlayerId: number; targetPlayerId: number; assetType: string; assetId: number; quantity: number }
) {
    if (input.assetType === 'ITEM') {
        const [source] = await tx
            .select()
            .from(items)
            .where(and(eq(items.id, input.assetId), eq(items.player_id, input.sourcePlayerId)))
            .limit(1)
            .for('update');
        if (!source || source.quantity < input.quantity) throw httpError(409, 'Trade item is no longer available');
        if (source.is_equipped) throw httpError(409, 'Trade item is now equipped');
        const [target] = await tx
            .select()
            .from(items)
            .where(
                and(
                    eq(items.player_id, input.targetPlayerId),
                    source.catalog_id ? eq(items.catalog_id, source.catalog_id) : eq(items.name, source.name),
                    eq(items.type, source.type),
                    eq(items.is_equipped, false)
                )
            )
            .limit(1)
            .for('update');
        if (target) {
            await tx
                .update(items)
                .set({ quantity: target.quantity + input.quantity })
                .where(eq(items.id, target.id));
        } else {
            await tx.insert(items).values({
                player_id: input.targetPlayerId,
                catalog_id: source.catalog_id,
                name: source.name,
                type: source.type,
                effect: source.effect,
                description: source.description,
                quantity: input.quantity,
                price_kreuzer: source.price_kreuzer,
                weight_grams: source.weight_grams,
                default_slot: source.default_slot,
                armor_rs: source.armor_rs,
                armor_be: source.armor_be,
            });
        }
        if (source.quantity === input.quantity) await tx.delete(items).where(eq(items.id, source.id));
        else
            await tx
                .update(items)
                .set({ quantity: source.quantity - input.quantity })
                .where(eq(items.id, source.id));
        return;
    }
    if (input.assetType !== 'WEAPON' || input.quantity !== 1) throw httpError(400, 'Invalid trade asset');
    const [weapon] = await tx
        .select()
        .from(weapons)
        .where(and(eq(weapons.id, input.assetId), eq(weapons.player_id, input.sourcePlayerId)))
        .limit(1)
        .for('update');
    if (!weapon) throw httpError(409, 'Trade weapon is no longer available');
    if (weapon.is_equipped === 'Y') throw httpError(409, 'Trade weapon is now equipped');
    await tx.update(weapons).set({ player_id: input.targetPlayerId }).where(eq(weapons.id, weapon.id));
}

export async function createTrade(
    ctx: Ctx,
    input: {
        recipientDiscordId: string;
        offeredKreuzer?: number;
        requestedKreuzer?: number;
        offeredAssets?: TradeAssetInput[];
        requestedAssets?: TradeAssetInput[];
        expiresHours?: number;
    }
) {
    const initiator = await getSelectedPlayer(ctx);
    const [recipient] = await db
        .select()
        .from(players)
        .where(and(eq(players.discord_id, input.recipientDiscordId), eq(players.selected, 'YES')))
        .limit(1);
    if (!recipient) throw httpError(404, 'Recipient has no selected character');
    if (recipient.id === initiator.id) throw httpError(400, 'Cannot trade with the same character');
    const offeredKreuzer = currency(input.offeredKreuzer, 'offeredKreuzer');
    const requestedKreuzer = currency(input.requestedKreuzer, 'requestedKreuzer');
    const offeredInputs = input.offeredAssets ?? [];
    const requestedInputs = input.requestedAssets ?? [];
    if (offeredInputs.length > 10 || requestedInputs.length > 10)
        throw httpError(400, 'A trade supports at most 10 assets per side');
    if (offeredKreuzer + requestedKreuzer === 0 && offeredInputs.length + requestedInputs.length === 0) {
        throw httpError(400, 'Trade must exchange currency or an asset');
    }
    for (const [side, assets] of [
        ['offered', offeredInputs],
        ['requested', requestedInputs],
    ] as const) {
        const uniqueAssets = new Set(assets.map(asset => `${asset.assetType}:${asset.assetId}`));
        if (uniqueAssets.size !== assets.length) {
            throw httpError(400, `${side}Assets contains a duplicate asset`);
        }
    }
    const expiresHours = input.expiresHours ?? 72;
    if (!Number.isInteger(expiresHours) || expiresHours < 1 || expiresHours > 168) {
        throw httpError(400, 'expiresHours must be an integer from 1 to 168');
    }
    const [offeredAssets, requestedAssets] = await Promise.all([
        Promise.all(offeredInputs.map(asset => loadAssetSnapshot(initiator.id, asset))),
        Promise.all(requestedInputs.map(asset => loadAssetSnapshot(recipient.id, asset))),
    ]);
    return db.transaction(async tx => {
        const [trade] = await tx
            .insert(trades)
            .values({
                initiator_player_id: initiator.id,
                recipient_player_id: recipient.id,
                offered_kreuzer: offeredKreuzer,
                requested_kreuzer: requestedKreuzer,
                expires_at: new Date(Date.now() + expiresHours * 60 * 60 * 1000),
            })
            .returning();
        const assetRows = [
            ...offeredAssets.map(asset => ({ ...asset, side: 'OFFER' })),
            ...requestedAssets.map(asset => ({ ...asset, side: 'REQUEST' })),
        ];
        if (assetRows.length > 0) {
            await tx.insert(tradeItems).values(
                assetRows.map(asset => ({
                    trade_id: trade.id,
                    side: asset.side,
                    asset_type: asset.assetType,
                    asset_id: asset.assetId,
                    quantity: asset.quantity,
                    name_snapshot: asset.name,
                }))
            );
        }
        return { trade, offeredAssets, requestedAssets, initiator: initiator.name, recipient: recipient.name };
    });
}

export async function listTrades(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    await db
        .update(trades)
        .set({ status: 'EXPIRED', updated_at: new Date() })
        .where(
            and(
                or(eq(trades.initiator_player_id, player.id), eq(trades.recipient_player_id, player.id)),
                eq(trades.status, 'PENDING'),
                lte(trades.expires_at, new Date())
            )
        );
    const rows = await db
        .select()
        .from(trades)
        .where(or(eq(trades.initiator_player_id, player.id), eq(trades.recipient_player_id, player.id)))
        .orderBy(desc(trades.created_at))
        .limit(50);
    const assets = rows.length
        ? await db
              .select()
              .from(tradeItems)
              .where(
                  inArray(
                      tradeItems.trade_id,
                      rows.map(row => row.id)
                  )
              )
        : [];
    return rows.map(trade => ({ trade, assets: assets.filter(asset => asset.trade_id === trade.id) }));
}

async function loadOwnedTrade(ctx: Ctx, tradeId: string) {
    const player = await getSelectedPlayer(ctx);
    const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1);
    if (!trade) throw httpError(404, 'Trade not found');
    if (![trade.initiator_player_id, trade.recipient_player_id].includes(player.id)) {
        throw httpError(403, 'Trade does not involve this character');
    }
    return { player, trade };
}

export async function acceptTrade(ctx: Ctx, tradeId: string) {
    const { player, trade: existing } = await loadOwnedTrade(ctx, tradeId);
    if (existing.recipient_player_id !== player.id) throw httpError(403, 'Only the recipient may accept a trade');
    if (existing.expires_at.getTime() <= Date.now()) {
        await db.update(trades).set({ status: 'EXPIRED', updated_at: new Date() }).where(eq(trades.id, tradeId));
        throw httpError(409, 'Trade has expired');
    }
    return db.transaction(async tx => {
        const [trade] = await tx.select().from(trades).where(eq(trades.id, tradeId)).limit(1).for('update');
        if (!trade || trade.status !== 'PENDING') throw httpError(409, 'Trade is no longer pending');
        if (trade.expires_at.getTime() <= Date.now()) {
            await tx.update(trades).set({ status: 'EXPIRED', updated_at: new Date() }).where(eq(trades.id, trade.id));
            throw httpError(409, 'Trade has expired');
        }
        await lockWalletsInTransaction(tx, [trade.initiator_player_id, trade.recipient_player_id]);
        const assets = await tx.select().from(tradeItems).where(eq(tradeItems.trade_id, trade.id));
        for (const asset of assets.sort(
            (a, b) => a.asset_type.localeCompare(b.asset_type) || a.asset_id - b.asset_id
        )) {
            await transferAsset(tx, {
                sourcePlayerId: asset.side === 'OFFER' ? trade.initiator_player_id : trade.recipient_player_id,
                targetPlayerId: asset.side === 'OFFER' ? trade.recipient_player_id : trade.initiator_player_id,
                assetType: asset.asset_type,
                assetId: asset.asset_id,
                quantity: asset.quantity,
            });
        }
        if (trade.offered_kreuzer > 0) {
            await changeWalletBalanceInTransaction(tx, ctx, trade.initiator_player_id, -trade.offered_kreuzer, {
                category: 'TRADE',
                referenceType: 'TRADE',
                referenceId: trade.id,
                description: 'Trade offer paid',
            });
            await changeWalletBalanceInTransaction(tx, ctx, trade.recipient_player_id, trade.offered_kreuzer, {
                category: 'TRADE',
                referenceType: 'TRADE',
                referenceId: trade.id,
                description: 'Trade offer received',
            });
        }
        if (trade.requested_kreuzer > 0) {
            await changeWalletBalanceInTransaction(tx, ctx, trade.recipient_player_id, -trade.requested_kreuzer, {
                category: 'TRADE',
                referenceType: 'TRADE',
                referenceId: trade.id,
                description: 'Trade request paid',
            });
            await changeWalletBalanceInTransaction(tx, ctx, trade.initiator_player_id, trade.requested_kreuzer, {
                category: 'TRADE',
                referenceType: 'TRADE',
                referenceId: trade.id,
                description: 'Trade request received',
            });
        }
        await synchronizeEquipmentDerivedStatsInTransaction(tx, trade.initiator_player_id);
        await synchronizeEquipmentDerivedStatsInTransaction(tx, trade.recipient_player_id);
        const [updated] = await tx
            .update(trades)
            .set({ status: 'ACCEPTED', updated_at: new Date() })
            .where(eq(trades.id, trade.id))
            .returning();
        return { trade: updated, assets };
    });
}

export async function declineTrade(ctx: Ctx, tradeId: string) {
    const { player, trade } = await loadOwnedTrade(ctx, tradeId);
    if (trade.recipient_player_id !== player.id) throw httpError(403, 'Only the recipient may decline a trade');
    if (trade.status !== 'PENDING') throw httpError(409, 'Trade is no longer pending');
    const [updated] = await db
        .update(trades)
        .set({ status: 'DECLINED', updated_at: new Date() })
        .where(and(eq(trades.id, trade.id), eq(trades.status, 'PENDING')))
        .returning();
    if (!updated) throw httpError(409, 'Trade changed concurrently');
    return updated;
}

export async function cancelTrade(ctx: Ctx, tradeId: string) {
    const { player, trade } = await loadOwnedTrade(ctx, tradeId);
    if (trade.initiator_player_id !== player.id) throw httpError(403, 'Only the initiator may cancel a trade');
    if (trade.status !== 'PENDING') throw httpError(409, 'Trade is no longer pending');
    const [updated] = await db
        .update(trades)
        .set({ status: 'CANCELLED', updated_at: new Date() })
        .where(and(eq(trades.id, trade.id), eq(trades.status, 'PENDING')))
        .returning();
    if (!updated) throw httpError(409, 'Trade changed concurrently');
    return updated;
}
