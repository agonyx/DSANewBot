import { and, desc, eq, or } from 'drizzle-orm';
import { db } from '../db';
import { combatants, combatSessions, equipmentCatalog, lootEntries, lootPools, players } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { generateLootPlan } from '../utils/economyUtils';
import { changeWalletBalanceInTransaction, grantCatalogItemInTransaction } from './economy';
import { synchronizeEquipmentDerivedStatsInTransaction } from './equipment';
import type { Ctx } from './_ctx';

async function loadSession(sessionId: string) {
    const [session] = await db.select().from(combatSessions).where(eq(combatSessions.id, sessionId)).limit(1);
    if (!session) throw httpError(404, 'Combat session not found');
    return session;
}

function assertDm(session: typeof combatSessions.$inferSelect, ctx: Ctx) {
    if (session.dm_user_id !== ctx.discordId) throw httpError(403, 'Only the DM can manage loot');
}

async function isSessionParticipant(sessionId: string, discordId: string, playerId?: number) {
    const [participant] = await db
        .select({ id: combatants.id })
        .from(combatants)
        .leftJoin(players, eq(combatants.player_id, players.id))
        .where(
            and(
                eq(combatants.session_id, sessionId),
                or(
                    eq(combatants.discord_user_id, discordId),
                    eq(players.discord_id, discordId),
                    ...(playerId ? [eq(combatants.player_id, playerId)] : [])
                )
            )
        )
        .limit(1);
    return Boolean(participant);
}

async function assertMayView(session: typeof combatSessions.$inferSelect, ctx: Ctx) {
    if (session.dm_user_id === ctx.discordId) return;
    if (!(await isSessionParticipant(session.id, ctx.discordId))) {
        throw httpError(403, 'Only the DM and combat participants may view this loot');
    }
}

async function loadPool(poolId: string) {
    const [row] = await db
        .select({ pool: lootPools, session: combatSessions })
        .from(lootPools)
        .innerJoin(combatSessions, eq(lootPools.session_id, combatSessions.id))
        .where(eq(lootPools.id, poolId))
        .limit(1);
    if (!row) throw httpError(404, 'Loot pool not found');
    return row;
}

export async function generateLoot(
    ctx: Ctx,
    input: { sessionId: string; tier: number; name?: string; random?: () => number }
) {
    const session = await loadSession(input.sessionId);
    assertDm(session, ctx);
    if (session.state !== 'ENDED') throw httpError(409, 'Loot can be generated after combat has ended');
    const name = input.name?.trim() || `Beute – Stufe ${input.tier}`;
    if (name.length > 100) throw httpError(400, 'name must be at most 100 characters');
    const catalog = await db.select().from(equipmentCatalog).orderBy(equipmentCatalog.name);
    let plan: ReturnType<typeof generateLootPlan>;
    try {
        plan = generateLootPlan(
            catalog.map(entry => ({
                id: entry.id,
                name: entry.name,
                category: entry.category,
                priceKreuzer: entry.price_kreuzer,
            })),
            input.tier,
            input.random
        );
    } catch (error) {
        throw httpError(400, error instanceof Error ? error.message : 'Invalid loot settings');
    }
    if (plan.entries.length === 0) {
        throw httpError(409, 'The equipment catalog has no eligible entries. Run the local seed first.');
    }
    return db.transaction(async tx => {
        const [pool] = await tx
            .insert(lootPools)
            .values({
                session_id: session.id,
                name,
                tier: plan.tier,
                currency_remaining_kreuzer: plan.currencyRemainingKreuzer,
                created_by_discord_id: ctx.discordId,
            })
            .returning();
        const entries = await tx
            .insert(lootEntries)
            .values(
                plan.entries.map(entry => ({
                    pool_id: pool.id,
                    catalog_id: entry.id,
                    quantity_remaining: entry.quantity,
                }))
            )
            .returning();
        return { pool, entries, generated: plan.entries };
    });
}

export async function getLootPool(ctx: Ctx, poolId: string) {
    const row = await loadPool(poolId);
    await assertMayView(row.session, ctx);
    const entries = await db
        .select({ entry: lootEntries, catalog: equipmentCatalog })
        .from(lootEntries)
        .innerJoin(equipmentCatalog, eq(lootEntries.catalog_id, equipmentCatalog.id))
        .where(eq(lootEntries.pool_id, row.pool.id))
        .orderBy(equipmentCatalog.name);
    return { ...row, entries };
}

export async function listLootPools(ctx: Ctx, sessionId: string) {
    const session = await loadSession(sessionId);
    await assertMayView(session, ctx);
    return db.select().from(lootPools).where(eq(lootPools.session_id, session.id)).orderBy(desc(lootPools.created_at));
}

export async function awardLoot(
    ctx: Ctx,
    input: {
        poolId: string;
        targetDiscordId: string;
        currencyKreuzer?: number;
        entryId?: string;
        quantity?: number;
    }
) {
    const row = await loadPool(input.poolId);
    assertDm(row.session, ctx);
    const currency = input.currencyKreuzer ?? 0;
    const quantity = input.quantity ?? 1;
    if (!Number.isSafeInteger(currency) || currency < 0) {
        throw httpError(400, 'currencyKreuzer must be a non-negative safe integer');
    }
    if (input.entryId && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)) {
        throw httpError(400, 'quantity must be an integer from 1 to 100');
    }
    if (currency === 0 && !input.entryId) throw httpError(400, 'Award currency or a loot entry');
    const [target] = await db
        .select()
        .from(players)
        .where(and(eq(players.discord_id, input.targetDiscordId), eq(players.selected, 'YES')))
        .limit(1);
    if (!target) throw httpError(404, 'Target has no selected character');
    if (!(await isSessionParticipant(row.session.id, input.targetDiscordId, target.id))) {
        throw httpError(400, 'Target character did not participate in this combat');
    }

    return db.transaction(async tx => {
        const [pool] = await tx.select().from(lootPools).where(eq(lootPools.id, input.poolId)).limit(1).for('update');
        if (!pool) throw httpError(404, 'Loot pool not found');
        if (pool.status !== 'OPEN') throw httpError(409, 'Loot pool is not open');
        if (currency > pool.currency_remaining_kreuzer) throw httpError(409, 'Not enough currency remains in the pool');

        let granted: unknown[] = [];
        if (input.entryId) {
            const [lootEntry] = await tx
                .select()
                .from(lootEntries)
                .where(and(eq(lootEntries.id, input.entryId), eq(lootEntries.pool_id, pool.id)))
                .limit(1)
                .for('update');
            if (!lootEntry) throw httpError(404, 'Loot entry not found in this pool');
            if (lootEntry.quantity_remaining < quantity) throw httpError(409, 'Not enough loot quantity remains');
            const [catalogEntry] = await tx
                .select()
                .from(equipmentCatalog)
                .where(eq(equipmentCatalog.id, lootEntry.catalog_id))
                .limit(1);
            if (!catalogEntry) throw httpError(409, 'Catalog entry is no longer available');
            granted = await grantCatalogItemInTransaction(tx, target.id, catalogEntry, quantity);
            await tx
                .update(lootEntries)
                .set({ quantity_remaining: lootEntry.quantity_remaining - quantity })
                .where(eq(lootEntries.id, lootEntry.id));
        }

        let wallet: Awaited<ReturnType<typeof changeWalletBalanceInTransaction>> | null = null;
        if (currency > 0) {
            wallet = await changeWalletBalanceInTransaction(tx, ctx, target.id, currency, {
                category: 'LOOT',
                referenceType: 'LOOT_POOL',
                referenceId: pool.id,
                description: `Loot awarded from ${pool.name}`,
            });
        }
        const currencyRemaining = pool.currency_remaining_kreuzer - currency;
        const remainingEntries = await tx
            .select({ quantity: lootEntries.quantity_remaining })
            .from(lootEntries)
            .where(eq(lootEntries.pool_id, pool.id));
        const distributed = currencyRemaining === 0 && remainingEntries.every(entry => entry.quantity <= 0);
        const [updatedPool] = await tx
            .update(lootPools)
            .set({
                currency_remaining_kreuzer: currencyRemaining,
                status: distributed ? 'DISTRIBUTED' : 'OPEN',
                updated_at: new Date(),
            })
            .where(eq(lootPools.id, pool.id))
            .returning();
        const equipmentState = await synchronizeEquipmentDerivedStatsInTransaction(tx, target.id);
        return { pool: updatedPool, target: target.name, granted, wallet, equipmentState };
    });
}

export async function cancelLootPool(ctx: Ctx, poolId: string) {
    const row = await loadPool(poolId);
    assertDm(row.session, ctx);
    if (row.pool.status !== 'OPEN') throw httpError(409, 'Loot pool is not open');
    const [updated] = await db
        .update(lootPools)
        .set({ status: 'CANCELLED', updated_at: new Date() })
        .where(and(eq(lootPools.id, poolId), eq(lootPools.status, 'OPEN')))
        .returning();
    if (!updated) throw httpError(409, 'Loot pool changed concurrently');
    return updated;
}
