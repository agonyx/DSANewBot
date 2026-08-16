/**
 * In-process port of the create-combatant Edge Function
 * (DSABackend/supabase/functions/create-combatant).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { combatSessions, combatants, stats } from '../schema';
import { httpError } from './errors';
import { calculateWoundThreshold } from '../../utils/woundUtils';
import { CREATURE_SIZES, type CreatureSize } from '../../utils/combatEffectUtils';

export interface CreateCombatantInput {
    sessionId: string;
    type: 'PLAYER' | 'NPC';
    allegiance: 'PLAYER_SIDE' | 'HOSTILE';
    playerId?: number | null;
    mobDefinitionId?: number | null;
    discordUserId?: string | null;
    name: string;
    maxHp: number;
    currentHp: number;
    wounds?: number;
    woundThreshold?: number | null;
    initiativeBase?: number;
    creatureSize?: CreatureSize;
}

/** Add a combatant to a session (validates state + prevents duplicate Discord users). */
export async function createCombatant(input: CreateCombatantInput) {
    const {
        sessionId,
        type,
        allegiance,
        playerId,
        mobDefinitionId,
        discordUserId,
        name,
        maxHp,
        currentHp,
        wounds: requestedWounds,
        woundThreshold: requestedWoundThreshold,
        initiativeBase,
        creatureSize = 'medium',
    } = input;

    if (!sessionId || !type || !allegiance || !name || maxHp === undefined || currentHp === undefined) {
        throw httpError(400, 'Missing required fields: sessionId, type, allegiance, name, maxHp, currentHp');
    }

    const [session] = await db
        .select({ id: combatSessions.id, state: combatSessions.state })
        .from(combatSessions)
        .where(eq(combatSessions.id, sessionId));
    if (!session) throw httpError(404, 'Combat session not found');
    if (session.state === 'ENDED') throw httpError(400, 'Cannot add combatant to ended session');

    if (discordUserId) {
        const [existing] = await db
            .select({ id: combatants.id })
            .from(combatants)
            .where(and(eq(combatants.session_id, sessionId), eq(combatants.discord_user_id, discordUserId)));
        if (existing) throw httpError(409, 'Discord user already has a combatant in this session');
    }

    let wounds = requestedWounds ?? 0;
    let woundThreshold = requestedWoundThreshold ?? null;
    let effectiveInitiativeBase = initiativeBase ?? 0;
    if (type === 'PLAYER' && playerId) {
        const [statRow] = await db.select().from(stats).where(eq(stats.player_id, playerId)).limit(1);
        if (!statRow) throw httpError(400, 'Player combatant has no stats');
        wounds = requestedWounds ?? statRow.wounds;
        woundThreshold =
            requestedWoundThreshold ?? calculateWoundThreshold(statRow.ko, statRow.wound_threshold_modifier);
        effectiveInitiativeBase = Math.max(0, (initiativeBase ?? statRow.initiative) - statRow.belastung);
    }
    if (!Number.isInteger(wounds) || wounds < 0) throw httpError(400, 'wounds must be a non-negative integer');
    if (woundThreshold !== null && (!Number.isInteger(woundThreshold) || woundThreshold < 0)) {
        throw httpError(400, 'woundThreshold must be a non-negative integer or null');
    }
    if (!CREATURE_SIZES.includes(creatureSize)) throw httpError(400, 'Invalid creature size');

    const [combatant] = await db
        .insert(combatants)
        .values({
            session_id: sessionId,
            type,
            allegiance,
            player_id: playerId ?? null,
            mob_definition_id: mobDefinitionId ?? null,
            discord_user_id: discordUserId ?? null,
            name,
            max_hp: maxHp,
            current_hp: currentHp,
            wounds,
            wound_threshold: woundThreshold && woundThreshold > 0 ? woundThreshold : null,
            initiative_base: effectiveInitiativeBase,
            creature_size: creatureSize,
        })
        .returning();

    return combatant;
}
