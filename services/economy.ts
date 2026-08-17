import { and, desc, eq, ilike, inArray } from 'drizzle-orm';
import { db } from '../db';
import { equipmentCatalog, items, stats, walletTransactions, wallets, weapons } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { calculateSellValue, fromKreuzer } from '../utils/economyUtils';
import { getSelectedPlayer } from './characters';
import { synchronizeEquipmentDerivedStatsInTransaction } from './equipment';
import type { Transaction } from './advancement';
import type { Ctx } from './_ctx';

interface WalletMetadata {
    category: string;
    referenceType?: string | null;
    referenceId?: string | null;
    description?: string | null;
}

function positiveQuantity(value: number | undefined, maximum = 100): number {
    const quantity = value ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
        throw httpError(400, `quantity must be an integer from 1 to ${maximum}`);
    }
    return quantity;
}

async function lockedWallet(tx: Transaction, playerId: number) {
    await tx.insert(wallets).values({ player_id: playerId }).onConflictDoNothing({ target: wallets.player_id });
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.player_id, playerId)).limit(1).for('update');
    if (!wallet) throw httpError(500, 'Wallet could not be initialized');
    return wallet;
}

export async function lockWalletsInTransaction(tx: Transaction, playerIds: number[]) {
    const ids = [...new Set(playerIds)].sort((a, b) => a - b);
    if (ids.length === 0) return [];
    await tx
        .insert(wallets)
        .values(ids.map(playerId => ({ player_id: playerId })))
        .onConflictDoNothing({ target: wallets.player_id });
    return tx.select().from(wallets).where(inArray(wallets.player_id, ids)).orderBy(wallets.player_id).for('update');
}

export async function changeWalletBalanceInTransaction(
    tx: Transaction,
    ctx: Ctx,
    playerId: number,
    amountKreuzer: number,
    metadata: WalletMetadata
) {
    if (!Number.isSafeInteger(amountKreuzer) || amountKreuzer === 0) {
        throw httpError(400, 'Wallet change must be a non-zero safe integer');
    }
    const wallet = await lockedWallet(tx, playerId);
    const balanceAfter = wallet.balance_kreuzer + amountKreuzer;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0 || balanceAfter > 2_000_000_000) {
        throw httpError(
            amountKreuzer < 0 ? 400 : 409,
            amountKreuzer < 0 ? 'Insufficient funds' : 'Wallet limit exceeded'
        );
    }
    await tx
        .update(wallets)
        .set({ balance_kreuzer: balanceAfter, updated_at: new Date() })
        .where(eq(wallets.id, wallet.id));
    const [ledger] = await tx
        .insert(walletTransactions)
        .values({
            player_id: playerId,
            amount_kreuzer: amountKreuzer,
            balance_after: balanceAfter,
            category: metadata.category,
            reference_type: metadata.referenceType ?? null,
            reference_id: metadata.referenceId ?? null,
            description: metadata.description ?? null,
            actor_discord_id: ctx.discordId,
        })
        .returning();
    return { balanceAfter, denominations: fromKreuzer(balanceAfter), ledger };
}

export async function getWallet(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    await db.insert(wallets).values({ player_id: player.id }).onConflictDoNothing({ target: wallets.player_id });
    const [wallet, ledger] = await Promise.all([
        db.select().from(wallets).where(eq(wallets.player_id, player.id)).limit(1),
        db
            .select()
            .from(walletTransactions)
            .where(eq(walletTransactions.player_id, player.id))
            .orderBy(desc(walletTransactions.created_at))
            .limit(50),
    ]);
    const balance = wallet[0]?.balance_kreuzer ?? 0;
    return { characterName: player.name, balance: fromKreuzer(balance), ledger };
}

export async function adjustWallet(ctx: Ctx, input: { amountKreuzer: number; reason: string }) {
    const player = await getSelectedPlayer(ctx);
    if (!input.reason?.trim() || input.reason.trim().length > 200) {
        throw httpError(400, 'reason is required and must be at most 200 characters');
    }
    return db.transaction(tx =>
        changeWalletBalanceInTransaction(tx, ctx, player.id, input.amountKreuzer, {
            category: 'MANUAL_ADJUSTMENT',
            description: input.reason.trim(),
        })
    );
}

export async function listCatalog(_ctx: Ctx, input: { search?: string; category?: string; limit?: number } = {}) {
    const limit = Number.isInteger(input.limit) ? Math.min(100, Math.max(1, input.limit!)) : 25;
    const filters = [];
    if (input.search?.trim()) filters.push(ilike(equipmentCatalog.name, `%${input.search.trim()}%`));
    if (input.category?.trim()) filters.push(eq(equipmentCatalog.category, input.category.trim().toUpperCase()));
    return db
        .select()
        .from(equipmentCatalog)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(equipmentCatalog.category, equipmentCatalog.name)
        .limit(limit);
}

export async function getCatalogEntry(_ctx: Ctx, catalogId: string) {
    const [entry] = await db.select().from(equipmentCatalog).where(eq(equipmentCatalog.id, catalogId)).limit(1);
    if (!entry) throw httpError(404, 'Catalog item not found');
    return entry;
}

export async function grantCatalogItemInTransaction(
    tx: Transaction,
    playerId: number,
    entry: typeof equipmentCatalog.$inferSelect,
    quantity: number
) {
    const isWeapon = entry.category === 'WEAPON' || entry.category === 'SHIELD';
    const normalizedQuantity = positiveQuantity(quantity, isWeapon ? 10 : 100);
    if (isWeapon) {
        const [statRow] = await tx.select().from(stats).where(eq(stats.player_id, playerId)).limit(1);
        if (!statRow) throw httpError(404, 'Character stats not found');
        return tx
            .insert(weapons)
            .values(
                Array.from({ length: normalizedQuantity }, () => ({
                    player_id: playerId,
                    catalog_id: entry.id,
                    name: entry.name,
                    type: entry.weapon_type ?? 'MELEE',
                    combat_technique: entry.combat_technique,
                    tp: entry.tp ?? '1w6',
                    at: Math.max(0, statRow.attacke_basis + entry.at_modifier),
                    pa: Math.max(0, statRow.parade_basis + entry.pa_modifier + entry.shield_pa_bonus * 2),
                    range_close: entry.range_close,
                    range_medium: entry.range_medium,
                    range_far: entry.range_far,
                    reload_actions: entry.reload_actions,
                    is_two_handed: entry.is_two_handed,
                    price_kreuzer: entry.price_kreuzer,
                    weight_grams: entry.weight_grams,
                    shield_pa_bonus: entry.shield_pa_bonus,
                }))
            )
            .returning();
    }

    const [existing] = await tx
        .select()
        .from(items)
        .where(and(eq(items.player_id, playerId), eq(items.catalog_id, entry.id), eq(items.is_equipped, false)))
        .limit(1)
        .for('update');
    if (existing) {
        return tx
            .update(items)
            .set({ quantity: existing.quantity + normalizedQuantity })
            .where(eq(items.id, existing.id))
            .returning();
    }
    return tx
        .insert(items)
        .values({
            player_id: playerId,
            catalog_id: entry.id,
            name: entry.name,
            type: entry.category,
            description: entry.description,
            quantity: normalizedQuantity,
            price_kreuzer: entry.price_kreuzer,
            weight_grams: entry.weight_grams,
            default_slot: entry.default_slot,
            armor_rs: entry.armor_rs,
            armor_be: entry.armor_be,
        })
        .returning();
}

export async function buyCatalogItem(ctx: Ctx, input: { catalogId: string; quantity?: number }) {
    const player = await getSelectedPlayer(ctx);
    const [entry] = await db.select().from(equipmentCatalog).where(eq(equipmentCatalog.id, input.catalogId)).limit(1);
    if (!entry) throw httpError(404, 'Catalog item not found');
    const isWeapon = entry.category === 'WEAPON' || entry.category === 'SHIELD';
    const quantity = positiveQuantity(input.quantity, isWeapon ? 10 : 100);
    const totalPrice = entry.price_kreuzer * quantity;
    if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0) throw httpError(400, 'Catalog price is invalid');
    return db.transaction(async tx => {
        const wallet = await changeWalletBalanceInTransaction(tx, ctx, player.id, -totalPrice, {
            category: 'BUY',
            referenceType: 'CATALOG',
            referenceId: entry.id,
            description: `Bought ${quantity} × ${entry.name}`,
        });
        const purchased = await grantCatalogItemInTransaction(tx, player.id, entry, quantity);
        const equipmentState = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { entry, quantity, totalPrice, purchased, wallet, equipmentState };
    });
}

export async function sellOwnedAsset(
    ctx: Ctx,
    input: { assetType: 'ITEM' | 'WEAPON'; assetId: number; quantity?: number }
) {
    const player = await getSelectedPlayer(ctx);
    if (!Number.isInteger(input.assetId) || input.assetId < 1) throw httpError(400, 'assetId must be positive');
    if (input.assetType !== 'ITEM' && input.assetType !== 'WEAPON') {
        throw httpError(400, 'assetType must be ITEM or WEAPON');
    }
    return db.transaction(async tx => {
        let name: string;
        let saleValue: number;
        let quantity = 1;
        if (input.assetType === 'ITEM') {
            const [item] = await tx
                .select()
                .from(items)
                .where(and(eq(items.id, input.assetId), eq(items.player_id, player.id)))
                .limit(1)
                .for('update');
            if (!item) throw httpError(404, 'Item not found');
            if (item.is_equipped) throw httpError(409, 'Unequip the item before selling it');
            quantity = positiveQuantity(input.quantity);
            if (item.quantity < quantity) throw httpError(409, 'Not enough item quantity');
            if (item.price_kreuzer <= 0) throw httpError(400, 'This item has no sale value');
            name = item.name;
            saleValue = calculateSellValue(item.price_kreuzer, quantity);
            if (item.quantity === quantity) await tx.delete(items).where(eq(items.id, item.id));
            else
                await tx
                    .update(items)
                    .set({ quantity: item.quantity - quantity })
                    .where(eq(items.id, item.id));
        } else {
            if (input.quantity !== undefined && input.quantity !== 1)
                throw httpError(400, 'Weapons sell one at a time');
            const [weapon] = await tx
                .select()
                .from(weapons)
                .where(and(eq(weapons.id, input.assetId), eq(weapons.player_id, player.id)))
                .limit(1)
                .for('update');
            if (!weapon) throw httpError(404, 'Weapon not found');
            if (weapon.is_equipped === 'Y') throw httpError(409, 'Unequip the weapon before selling it');
            if (weapon.price_kreuzer <= 0) throw httpError(400, 'This weapon has no sale value');
            name = weapon.name;
            saleValue = calculateSellValue(weapon.price_kreuzer);
            await tx.delete(weapons).where(eq(weapons.id, weapon.id));
        }
        const wallet = await changeWalletBalanceInTransaction(tx, ctx, player.id, saleValue, {
            category: 'SELL',
            referenceType: input.assetType,
            referenceId: String(input.assetId),
            description: `Sold ${quantity} × ${name}`,
        });
        const equipmentState = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return {
            assetType: input.assetType,
            assetId: input.assetId,
            name,
            quantity,
            saleValue,
            wallet,
            equipmentState,
        };
    });
}
