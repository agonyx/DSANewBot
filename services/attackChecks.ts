import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { actionModifications, playerActionModifications, players, stats, weapons } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { resolveAttack } from '../utils/combatUtils';
import { calculateWoundPenalty, isIncapacitatedByWounds } from '../utils/woundUtils';
import type { Ctx } from './_ctx';

export async function performAttackCheck(ctx: Ctx, input: { maneuverId?: string | null; modifier?: number }) {
    const modifier = input.modifier ?? 0;
    if (!Number.isInteger(modifier) || modifier < -20 || modifier > 20) {
        throw httpError(400, 'modifier must be an integer from -20 to 20');
    }
    const [player] = await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(and(eq(players.discord_id, ctx.discordId), eq(players.selected, 'YES')))
        .limit(1);
    if (!player) throw httpError(404, 'No selected character. Use /character select first.');
    const [[statRow], weaponRows] = await Promise.all([
        db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1),
        db.select().from(weapons).where(eq(weapons.player_id, player.id)),
    ]);
    if (!statRow) throw httpError(400, 'The selected character has no stats');
    if (isIncapacitatedByWounds(statRow.wounds)) throw httpError(400, `${player.name} is incapacitated by wounds`);
    const weapon = weaponRows.find(
        row => row.is_equipped === 'Y' && (row.equipped_slot === 'OFFENSE' || row.equipped_slot === 'ADAPTIVE')
    );
    let maneuver: { name: string; rules: unknown; action_type: string | null } | null = null;
    if (input.maneuverId) {
        const [learned] = await db
            .select({
                name: actionModifications.name,
                rules: actionModifications.rules,
                action_type: actionModifications.action_type,
            })
            .from(playerActionModifications)
            .innerJoin(
                actionModifications,
                eq(playerActionModifications.action_modification_id, actionModifications.id)
            )
            .where(
                and(eq(playerActionModifications.player_id, player.id), eq(actionModifications.id, input.maneuverId))
            )
            .limit(1);
        if (!learned) throw httpError(403, 'The selected character has not learned this maneuver');
        if (learned.action_type && learned.action_type !== (weapon?.type ?? 'MELEE')) {
            throw httpError(400, `${learned.name} is incompatible with the equipped weapon`);
        }
        maneuver = learned;
    }
    const rules =
        maneuver?.rules && typeof maneuver.rules === 'object'
            ? (maneuver.rules as { at_modifier?: number; type?: string })
            : {};
    if (rules.type && ['full_defense', 'masterful_parry', 'two_weapon_training'].includes(rules.type)) {
        throw httpError(400, `${maneuver!.name} is not an attack maneuver`);
    }
    const baseValue = weapon?.at ?? (statRow.attacke_basis || 8);
    const effectiveValue = Math.max(
        0,
        baseValue - calculateWoundPenalty(statRow.wounds) + modifier + (rules.at_modifier ?? 0)
    );
    const attack = resolveAttack(effectiveValue);
    return {
        character: { id: player.id, name: player.name },
        weapon: weapon ? { id: weapon.id, name: weapon.name, type: weapon.type } : null,
        maneuver: maneuver ? { name: maneuver.name } : null,
        baseValue,
        modifier,
        woundPenalty: calculateWoundPenalty(statRow.wounds),
        effectiveValue,
        attack,
    };
}
