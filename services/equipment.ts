import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { equipmentCatalog, items, stats, weapons } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { calculateCarryState } from '../utils/economyUtils';
import { getSelectedPlayer } from './characters';
import type { Transaction } from './advancement';
import type { Ctx } from './_ctx';

export const EQUIPMENT_SLOTS = [
    'HEAD',
    'BODY',
    'ARMS',
    'HANDS',
    'LEGS',
    'FEET',
    'BACK',
    'WAIST',
    'NECK',
    'ACCESSORY',
] as const;

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

function assertSlot(value: string): asserts value is EquipmentSlot {
    if (!EQUIPMENT_SLOTS.includes(value as EquipmentSlot)) {
        throw httpError(400, `slot must be one of ${EQUIPMENT_SLOTS.join(', ')}`);
    }
}

export async function synchronizeEquipmentDerivedStatsInTransaction(tx: Transaction, playerId: number) {
    const [statRow] = await tx.select().from(stats).where(eq(stats.player_id, playerId)).limit(1).for('update');
    if (!statRow) throw httpError(404, 'Character stats not found');
    const itemRows = await tx.select().from(items).where(eq(items.player_id, playerId));
    const weaponRows = await tx.select().from(weapons).where(eq(weapons.player_id, playerId));
    const itemWeight = itemRows.reduce(
        (sum, item) => sum + Math.max(0, item.weight_grams) * Math.max(0, item.quantity),
        0
    );
    const weaponWeight = weaponRows.reduce((sum, weapon) => sum + Math.max(0, weapon.weight_grams), 0);
    const equippedArmor = itemRows.filter(item => item.is_equipped && item.type === 'ARMOR');
    const equippedArmorWeight = equippedArmor.reduce((sum, item) => sum + Math.max(0, item.weight_grams), 0);
    const armorRs = itemRows
        .filter(item => item.is_equipped)
        .reduce((sum, item) => sum + Math.max(0, item.armor_rs), 0);
    const armorBe = itemRows
        .filter(item => item.is_equipped)
        .reduce((sum, item) => sum + Math.max(0, item.armor_be), 0);
    const state = calculateCarryState({
        strength: statRow.kk,
        carriedWeightGrams: itemWeight + weaponWeight,
        equippedArmorWeightGrams: equippedArmorWeight,
        armorRs,
        armorBe,
        naturalArmor: statRow.natural_armor,
    });
    await tx
        .update(stats)
        .set({ ruestungsschutz: state.armorSoak, belastung: state.encumbrance })
        .where(eq(stats.id, statRow.id));
    return state;
}

export async function synchronizeEquipmentDerivedStatsForPlayer(playerId: number) {
    return db.transaction(tx => synchronizeEquipmentDerivedStatsInTransaction(tx, playerId));
}

export async function getEquipmentSummary(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    const state = await synchronizeEquipmentDerivedStatsForPlayer(player.id);
    const [itemRows, weaponRows] = await Promise.all([
        db.select().from(items).where(eq(items.player_id, player.id)).orderBy(items.type, items.name),
        db.select().from(weapons).where(eq(weapons.player_id, player.id)).orderBy(weapons.name),
    ]);
    return { characterName: player.name, items: itemRows, weapons: weaponRows, state };
}

export async function equipItem(ctx: Ctx, input: { itemId: number; slot?: string | null }) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [item] = await tx
            .select()
            .from(items)
            .where(and(eq(items.id, input.itemId), eq(items.player_id, player.id)))
            .limit(1)
            .for('update');
        if (!item) throw httpError(404, 'Item not found');
        if (item.quantity < 1) throw httpError(400, 'Item has no usable quantity');
        const slot = (input.slot ?? item.default_slot)?.toUpperCase();
        if (!slot) throw httpError(400, 'This item has no equipment slot');
        assertSlot(slot);
        if (item.default_slot && item.default_slot !== slot) {
            throw httpError(400, `${item.name} must use the ${item.default_slot} slot`);
        }
        const conflicting = await tx
            .select({ id: items.id })
            .from(items)
            .where(and(eq(items.player_id, player.id), eq(items.is_equipped, true), eq(items.equipped_slot, slot)));
        if (conflicting.length > 0) {
            await tx
                .update(items)
                .set({ is_equipped: false, equipped_slot: null })
                .where(
                    inArray(
                        items.id,
                        conflicting.map(row => row.id)
                    )
                );
        }
        let updated: typeof items.$inferSelect;
        if (item.quantity > 1) {
            await tx
                .update(items)
                .set({ quantity: item.quantity - 1 })
                .where(eq(items.id, item.id));
            [updated] = await tx
                .insert(items)
                .values({
                    player_id: item.player_id,
                    catalog_id: item.catalog_id,
                    name: item.name,
                    type: item.type,
                    effect: item.effect,
                    description: item.description,
                    quantity: 1,
                    price_kreuzer: item.price_kreuzer,
                    weight_grams: item.weight_grams,
                    is_equipped: true,
                    default_slot: item.default_slot,
                    equipped_slot: slot,
                    armor_rs: item.armor_rs,
                    armor_be: item.armor_be,
                })
                .returning();
        } else {
            [updated] = await tx
                .update(items)
                .set({ is_equipped: true, equipped_slot: slot })
                .where(eq(items.id, item.id))
                .returning();
        }
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { item: updated, state };
    });
}

export async function unequipItem(ctx: Ctx, itemId: number) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [item] = await tx
            .select()
            .from(items)
            .where(and(eq(items.id, itemId), eq(items.player_id, player.id)))
            .limit(1)
            .for('update');
        if (!item) throw httpError(404, 'Item not found');
        if (!item.is_equipped) throw httpError(400, 'Item is not equipped');
        const [updated] = await tx
            .update(items)
            .set({ is_equipped: false, equipped_slot: null })
            .where(eq(items.id, item.id))
            .returning();
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { item: updated, state };
    });
}

export async function getCatalogItem(catalogId: string) {
    const [row] = await db.select().from(equipmentCatalog).where(eq(equipmentCatalog.id, catalogId)).limit(1);
    if (!row) throw httpError(404, 'Catalog item not found');
    return row;
}
