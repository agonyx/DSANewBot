/**
 * Inventory services — weapons + items for the caller's selected character.
 * ctx-authenticated; throw HttpError on business failures.
 */
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { weapons, items } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { getSelectedPlayer } from './characters';
import { EQUIPMENT_SLOTS, synchronizeEquipmentDerivedStatsInTransaction } from './equipment';
import type { Ctx } from './_ctx';

const TP_RE = /^\d+[wW]\d+(\s*[+-]\s*\d+)?$/;
const WEAPON_TYPES = new Set(['MELEE', 'RANGED']);

export interface AddWeaponInput {
    name: string;
    type: string;
    combatTechnique?: string | null;
    tp: string;
    at: number;
    pa: number;
    rangeClose?: number | null;
    rangeMedium?: number | null;
    rangeFar?: number | null;
    reloadActions?: number;
    isTwoHanded?: boolean;
    is_equipped?: 'Y' | 'N';
    equipped_slot?: 'ADAPTIVE' | 'OFFENSE' | 'DEFENSE' | null;
    priceKreuzer?: number;
    weightGrams?: number;
    shieldPaBonus?: number;
}

export async function addWeapon(ctx: Ctx, input: AddWeaponInput) {
    const player = await getSelectedPlayer(ctx);
    if (!input.name?.trim() || input.name.trim().length > 100) throw httpError(400, 'name is required (max 100)');
    if (!WEAPON_TYPES.has(input.type)) throw httpError(400, 'Invalid weapon type');
    if (!TP_RE.test(input.tp)) throw httpError(400, 'Invalid TP format (e.g. 1w6+3)');
    if (!Number.isInteger(input.at) || input.at < 0 || !Number.isInteger(input.pa) || input.pa < 0) {
        throw httpError(400, 'AT and PA must be non-negative integers');
    }
    for (const [name, value] of [
        ['priceKreuzer', input.priceKreuzer ?? 0],
        ['weightGrams', input.weightGrams ?? 0],
        ['shieldPaBonus', input.shieldPaBonus ?? 0],
    ] as const) {
        if (!Number.isInteger(value) || value < 0) throw httpError(400, `${name} must be a non-negative integer`);
    }
    let rangeClose: number | null = null;
    let rangeMedium: number | null = null;
    let rangeFar: number | null = null;
    let reloadActions = 0;
    const combatTechnique = input.combatTechnique?.trim() || (input.type === 'RANGED' ? 'Bögen' : 'Schwerter');
    if (combatTechnique.length > 80) throw httpError(400, 'combatTechnique must not exceed 80 characters');
    if (input.type === 'RANGED') {
        rangeClose = input.rangeClose ?? 10;
        rangeMedium = input.rangeMedium ?? 50;
        rangeFar = input.rangeFar ?? 100;
        reloadActions = input.reloadActions ?? 1;
        if (
            !Number.isInteger(rangeClose) ||
            !Number.isInteger(rangeMedium) ||
            !Number.isInteger(rangeFar) ||
            rangeClose <= 0 ||
            rangeMedium < rangeClose ||
            rangeFar < rangeMedium
        ) {
            throw httpError(400, 'Ranged distances must be positive integers in close <= medium <= far order');
        }
        if (!Number.isInteger(reloadActions) || reloadActions < 0 || reloadActions > 20) {
            throw httpError(400, 'reloadActions must be an integer from 0 to 20');
        }
    }
    const is_equipped = input.is_equipped ?? 'N';
    const equipped_slot = input.equipped_slot ?? null;
    if (is_equipped !== 'Y' && is_equipped !== 'N') throw httpError(400, 'is_equipped must be Y or N');
    if (equipped_slot && !['ADAPTIVE', 'OFFENSE', 'DEFENSE'].includes(equipped_slot)) {
        throw httpError(400, 'Invalid weapon slot');
    }
    if (is_equipped === 'Y' && !equipped_slot) {
        throw httpError(400, 'A slot is required when equipping a weapon');
    }
    return db.transaction(async tx => {
        if (is_equipped === 'Y') {
            const currentlyEquipped = await tx
                .select()
                .from(weapons)
                .where(and(eq(weapons.player_id, player.id), eq(weapons.is_equipped, 'Y')));
            for (const current of currentlyEquipped) {
                if (equipped_slot === 'ADAPTIVE' || current.equipped_slot === equipped_slot) {
                    await tx
                        .update(weapons)
                        .set({ is_equipped: 'N', equipped_slot: null })
                        .where(eq(weapons.id, current.id));
                } else if (current.equipped_slot === 'ADAPTIVE') {
                    await tx
                        .update(weapons)
                        .set({ equipped_slot: equipped_slot === 'OFFENSE' ? 'DEFENSE' : 'OFFENSE' })
                        .where(eq(weapons.id, current.id));
                }
            }
        }
        const [weapon] = await tx
            .insert(weapons)
            .values({
                name: input.name.trim(),
                type: input.type as 'MELEE' | 'RANGED',
                combat_technique: combatTechnique,
                tp: input.tp,
                at: input.at,
                pa: input.pa,
                range_close: rangeClose,
                range_medium: rangeMedium,
                range_far: rangeFar,
                reload_actions: reloadActions,
                is_two_handed: input.isTwoHanded ?? false,
                price_kreuzer: input.priceKreuzer ?? 0,
                weight_grams: input.weightGrams ?? 0,
                shield_pa_bonus: input.shieldPaBonus ?? 0,
                is_equipped,
                equipped_slot,
                player_id: player.id,
            })
            .returning();
        await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return weapon;
    });
}

export async function listWeapons(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    return db.select().from(weapons).where(eq(weapons.player_id, player.id));
}

export async function deleteWeapon(ctx: Ctx, weaponId: number) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [deleted] = await tx
            .delete(weapons)
            .where(and(eq(weapons.id, weaponId), eq(weapons.player_id, player.id)))
            .returning({ id: weapons.id });
        if (!deleted) throw httpError(404, 'Weapon not found');
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { deleted: true, state };
    });
}

export async function equipWeapon(
    ctx: Ctx,
    input: { weaponId: number; equippedSlot: 'ADAPTIVE' | 'OFFENSE' | 'DEFENSE' }
) {
    const player = await getSelectedPlayer(ctx);
    if (!['ADAPTIVE', 'OFFENSE', 'DEFENSE'].includes(input.equippedSlot)) {
        throw httpError(400, 'Invalid weapon slot');
    }
    return db.transaction(async tx => {
        const [weapon] = await tx
            .select({ id: weapons.id, player_id: weapons.player_id })
            .from(weapons)
            .where(eq(weapons.id, input.weaponId))
            .limit(1)
            .for('update');
        if (!weapon) throw httpError(404, 'Weapon not found');
        if (weapon.player_id !== player.id) throw httpError(403, 'Not your weapon');
        const equipped = await tx
            .select()
            .from(weapons)
            .where(and(eq(weapons.player_id, player.id), eq(weapons.is_equipped, 'Y')));
        for (const current of equipped) {
            if (current.id === input.weaponId) continue;
            if (input.equippedSlot === 'ADAPTIVE' || current.equipped_slot === input.equippedSlot) {
                await tx
                    .update(weapons)
                    .set({ is_equipped: 'N', equipped_slot: null })
                    .where(eq(weapons.id, current.id));
            } else if (current.equipped_slot === 'ADAPTIVE') {
                await tx
                    .update(weapons)
                    .set({ equipped_slot: input.equippedSlot === 'OFFENSE' ? 'DEFENSE' : 'OFFENSE' })
                    .where(eq(weapons.id, current.id));
            }
        }
        const [updated] = await tx
            .update(weapons)
            .set({ is_equipped: 'Y', equipped_slot: input.equippedSlot })
            .where(eq(weapons.id, input.weaponId))
            .returning();
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { weapon: updated, state };
    });
}

export async function unequipWeapon(ctx: Ctx, weaponId: number) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [updated] = await tx
            .update(weapons)
            .set({ is_equipped: 'N', equipped_slot: null })
            .where(and(eq(weapons.id, weaponId), eq(weapons.player_id, player.id)))
            .returning();
        if (!updated) throw httpError(404, 'Weapon not found');
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { weapon: updated, state };
    });
}

export interface AddItemInput {
    name: string;
    type?: string;
    effect?: string | null;
    description?: string | null;
    quantity?: number;
    priceKreuzer?: number;
    weightGrams?: number;
    defaultSlot?: string | null;
    armorRs?: number;
    armorBe?: number;
}

export async function addItem(ctx: Ctx, input: AddItemInput) {
    const player = await getSelectedPlayer(ctx);
    const type = (input.type || 'MISC').trim().toUpperCase();
    const quantity = input.quantity ?? 1;
    if (!input.name?.trim() || input.name.trim().length > 100) throw httpError(400, 'name is required (max 100)');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
        throw httpError(400, 'quantity must be an integer from 1 to 1000');
    }
    if (!/^[A-Z_]{1,40}$/.test(type)) throw httpError(400, 'type must contain only A-Z and underscores (max 40)');
    const defaultSlot = input.defaultSlot?.trim().toUpperCase() || null;
    if (defaultSlot && !EQUIPMENT_SLOTS.includes(defaultSlot as (typeof EQUIPMENT_SLOTS)[number])) {
        throw httpError(400, `defaultSlot must be one of ${EQUIPMENT_SLOTS.join(', ')}`);
    }
    for (const [name, value] of [
        ['priceKreuzer', input.priceKreuzer ?? 0],
        ['weightGrams', input.weightGrams ?? 0],
        ['armorRs', input.armorRs ?? 0],
        ['armorBe', input.armorBe ?? 0],
    ] as const) {
        if (!Number.isInteger(value) || value < 0) throw httpError(400, `${name} must be a non-negative integer`);
    }

    const normalized = {
        name: input.name.trim(),
        type,
        effect: input.effect?.trim() || null,
        description: input.description?.trim() || null,
        price: input.priceKreuzer ?? 0,
        weight: input.weightGrams ?? 0,
        slot: defaultSlot,
        armorRs: input.armorRs ?? 0,
        armorBe: input.armorBe ?? 0,
    };
    return db.transaction(async tx => {
        const candidates = await tx
            .select()
            .from(items)
            .where(
                and(
                    eq(items.player_id, player.id),
                    eq(items.name, normalized.name),
                    eq(items.type, normalized.type),
                    eq(items.is_equipped, false)
                )
            )
            .for('update');
        const existing = candidates.find(
            item =>
                item.effect === normalized.effect &&
                item.description === normalized.description &&
                item.price_kreuzer === normalized.price &&
                item.weight_grams === normalized.weight &&
                item.default_slot === normalized.slot &&
                item.armor_rs === normalized.armorRs &&
                item.armor_be === normalized.armorBe
        );
        let item: typeof items.$inferSelect;
        if (existing) {
            [item] = await tx
                .update(items)
                .set({ quantity: existing.quantity + quantity })
                .where(eq(items.id, existing.id))
                .returning();
        } else {
            [item] = await tx
                .insert(items)
                .values({
                    player_id: player.id,
                    name: normalized.name,
                    type: normalized.type,
                    effect: normalized.effect,
                    description: normalized.description,
                    quantity,
                    price_kreuzer: normalized.price,
                    weight_grams: normalized.weight,
                    default_slot: normalized.slot,
                    armor_rs: normalized.armorRs,
                    armor_be: normalized.armorBe,
                })
                .returning();
        }
        await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return item;
    });
}

export async function listItems(ctx: Ctx) {
    const player = await getSelectedPlayer(ctx);
    return db.select().from(items).where(eq(items.player_id, player.id));
}

export async function removeItem(ctx: Ctx, itemId: number) {
    const player = await getSelectedPlayer(ctx);
    return db.transaction(async tx => {
        const [owned] = await tx
            .select({ equipped: items.is_equipped })
            .from(items)
            .where(and(eq(items.id, itemId), eq(items.player_id, player.id)))
            .limit(1)
            .for('update');
        if (!owned) throw httpError(404, 'Item not found');
        if (owned.equipped) throw httpError(409, 'Unequip the item before removing it');
        await tx.delete(items).where(eq(items.id, itemId));
        const state = await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
        return { deleted: true, state };
    });
}
