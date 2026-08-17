/**
 * Transformation utilities for converting between database snake_case
 * and application camelCase formats.
 */

/**
 * Converts a combatant from database format (snake_case) to memory format (camelCase)
 * @param {Object} c - Combatant from database
 * @returns {Object} Combatant in camelCase format
 */
function combatantToMemory(c) {
    if (!c) return null;
    return {
        ...c,
        maxHP: c.max_hp,
        currentHP: c.current_hp,
        woundThreshold: c.wound_threshold,
        defenseCount: c.defense_count,
        creatureSize: c.creature_size,
        lastHitZone: c.last_hit_zone,
        movementSpeed: c.movement_speed,
        reloadRemaining: c.reload_remaining,
        initiativeRoll: c.initiative_roll,
        initiativeBase: c.initiative_base,
        playerId: c.player_id,
        discordUserId: c.discord_user_id,
        mobDefinitionId: c.mob_definition_id,
        sessionId: c.session_id,
        isActiveTurn: c.is_active_turn,
    };
}

/**
 * Converts a combatant from memory format (camelCase) to database format (snake_case)
 * @param {Object} c - Combatant from memory
 * @returns {Object} Combatant in snake_case format
 */
function combatantToDb(c) {
    if (!c) return null;
    return {
        ...c,
        max_hp: c.maxHP,
        current_hp: c.currentHP,
        wound_threshold: c.woundThreshold,
        defense_count: c.defenseCount,
        creature_size: c.creatureSize,
        last_hit_zone: c.lastHitZone,
        movement_speed: c.movementSpeed,
        reload_remaining: c.reloadRemaining,
        initiative_roll: c.initiativeRoll,
        initiative_base: c.initiativeBase,
        player_id: c.playerId,
        discord_user_id: c.discordUserId,
        mob_definition_id: c.mobDefinitionId,
        session_id: c.sessionId,
        is_active_turn: c.isActiveTurn,
    };
}

/**
 * Converts a combat session from database format (snake_case) to memory format (camelCase)
 * @param {Object} session - Session from database
 * @returns {Object} Session in camelCase format with converted combatants
 */
function sessionToMemory(session) {
    if (!session) return null;
    return {
        ...session,
        dmUserId: session.dm_user_id,
        channelId: session.channel_id,
        messageId: session.message_id,
        combatLog: session.combat_log,
        turnOrder: session.turn_order,
        currentTurnIndex: session.current_turn_index,
        currentRound: session.current_round,
        combatants: session.combatants?.map(combatantToMemory) || [],
    };
}

/**
 * Converts a combat session from memory format (camelCase) to database format (snake_case)
 * @param {Object} session - Session from memory
 * @returns {Object} Session in snake_case format (without combatants - update separately)
 */
function sessionToDb(session) {
    if (!session) return null;
    return {
        ...session,
        dm_user_id: session.dmUserId,
        channel_id: session.channelId,
        message_id: session.messageId,
        combat_log: session.combatLog,
        turn_order: session.turnOrder,
        current_turn_index: session.currentTurnIndex,
        current_round: session.currentRound,
    };
}

module.exports = {
    combatantToMemory,
    combatantToDb,
    sessionToMemory,
    sessionToDb,
};
