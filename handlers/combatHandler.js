/**
 * Combat Handler - Router
 * Routes combat interactions to domain-specific handlers:
 * - combatSetupHandler.js: SETUP phase interactions
 * - combatTurnHandler.js: RUNNING combat interactions
 * - npcHandler.js: DM-controlled NPC actions
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('combat-router');

// Import domain handlers
const setupHandler = require('./combatSetupHandler');
const turnHandler = require('./combatTurnHandler');
const npcHandler = require('./npcHandler');

/**
 * Routes button interactions to appropriate handlers based on customId prefix.
 */
async function handleCombatButton(interaction) {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Routing button');

    // --- SETUP Phase Handlers ---
    if (customId.startsWith('join_combat_')) {
        const sessionId = customId.substring('join_combat_'.length);
        await setupHandler.handleJoinCombatInteraction(interaction, sessionId);
    } else if (customId.startsWith('add_mob_modal_')) {
        const sessionId = customId.substring('add_mob_modal_'.length);
        await setupHandler.showAddMobModal(interaction, sessionId);
    } else if (customId.startsWith('start_fight_')) {
        const sessionId = customId.substring('start_fight_'.length);
        await setupHandler.handleStartFightInteraction(interaction, sessionId);
    } else if (customId.startsWith('cancel_combat_')) {
        const sessionId = customId.substring('cancel_combat_'.length);
        await setupHandler.handleCancelCombatInteraction(interaction, sessionId);
    } else if (customId.startsWith('leave_setup_')) {
        const sessionId = customId.substring('leave_setup_'.length);
        await setupHandler.handleLeaveSetupInteraction(interaction, sessionId);
    } else if (customId.startsWith('manage_participants_')) {
        const sessionId = customId.substring('manage_participants_'.length);
        await setupHandler.handleManageParticipantsInteraction(interaction, sessionId);
    }

    // --- RUNNING Phase: Player Actions ---
    else if (customId.startsWith('caa_')) {
        // Combat Action Attack
        const parts = customId.split('_');
        if (parts.length === 3) {
            const sessionId = parts[1];
            const actorId = parts[2];
            await turnHandler.handleCombatActionAttack(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid caa_ button ID format');
            await interaction.reply({ content: 'Error: Invalid attack button data.', ephemeral: true }).catch(() => {});
        }
    } else if (customId.startsWith('cas_')) {
        // Combat Action Skill
        const parts = customId.split('_');
        if (parts.length === 3) {
            const sessionId = parts[1];
            const actorId = parts[2];
            await turnHandler.handleCombatActionSkill(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid cas_ button ID format');
            await interaction.reply({ content: 'Error: Invalid skill button data.', ephemeral: true }).catch(() => {});
        }
    } else if (customId.startsWith('cad_')) {
        const parts = customId.split('_');
        if (parts.length === 3 && ['PARRY', 'DODGE', 'DECLINE'].includes(parts[2])) {
            await turnHandler.handlePendingDefenseInteraction(interaction, parts[1], parts[2]);
        } else {
            log.error({ customId }, 'Invalid cad_ defense button ID format');
            await interaction
                .reply({ content: 'Error: Invalid defense button data.', ephemeral: true })
                .catch(() => {});
        }
    } else if (customId.startsWith('cet_')) {
        // Combat End Turn (Player)
        const parts = customId.split('_');
        if (parts.length === 3) {
            const sessionId = parts[1];
            const actorId = parts[2];
            await turnHandler.handleCombatEndTurnInteraction(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid cet_ button ID format');
        }
    }

    // --- RUNNING Phase: DM NPC Actions ---
    else if (customId.startsWith('dmnpc_action_attack_')) {
        const parts = customId.split('_');
        if (parts.length === 5) {
            const sessionId = parts[3];
            const actorId = parts[4];
            await npcHandler.handleDmNpcAttackAction(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid dmnpc_action_attack_ customId format');
            await interaction
                .reply({ content: 'Error: Invalid NPC action button data.', ephemeral: true })
                .catch(() => {});
        }
    } else if (customId.startsWith('dmnpc_action_skill_')) {
        const parts = customId.split('_');
        if (parts.length === 5) {
            const sessionId = parts[3];
            const actorId = parts[4];
            await npcHandler.handleDmNpcSkillAction(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid dmnpc_action_skill_ customId format');
            await interaction
                .reply({ content: 'Error: Invalid NPC skill button data.', ephemeral: true })
                .catch(() => {});
        }
    } else if (customId.startsWith('dmnpc_action_endturn_')) {
        const parts = customId.split('_');
        if (parts.length === 5) {
            const sessionId = parts[3];
            const actorId = parts[4];
            await turnHandler.handleCombatEndTurnInteraction(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid dmnpc_action_endturn_ customId format');
        }
    }

    // --- RUNNING Phase: Session Management ---
    else if (customId.startsWith('show_full_log_')) {
        const sessionId = customId.substring('show_full_log_'.length);
        await turnHandler.handleShowFullLogInteraction(interaction, sessionId);
    } else if (customId.startsWith('park_combat_')) {
        const sessionId = customId.substring('park_combat_'.length);
        await turnHandler.handleParkCombatInteraction(interaction, sessionId);
    } else if (customId.startsWith('end_combat_')) {
        const sessionId = customId.substring('end_combat_'.length);
        await turnHandler.handleEndCombatInteraction(interaction, sessionId);
    } else {
        log.warn({ customId }, 'Unknown button prefix');
    }
}

/**
 * Routes select menu interactions to appropriate handlers based on customId prefix.
 */
async function handleCombatSelectMenu(interaction) {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Routing select menu');

    if (customId.startsWith('cact_')) {
        const parts = customId.split('_');
        await turnHandler.handleCombatActionMenuSelect(interaction, parts[1], parts[2]);
    } else if (customId.startsWith('cabil_')) {
        const parts = customId.split('_');
        await turnHandler.handleCombatAbilitySelect(interaction, parts[1], parts[2], parts[3]);
    } else if (customId.startsWith('cabt_')) {
        const parts = customId.split('_');
        await turnHandler.handleCombatAbilityTarget(interaction, parts[1], parts[2], parts[3], parts[4]);
    } else if (customId.startsWith('ctw_')) {
        const parts = customId.split('_');
        await turnHandler.handleTwoWeaponTargetSelect(interaction, parts[1], parts[2]);
    } else if (customId.startsWith('cop_')) {
        const parts = customId.split('_');
        await turnHandler.handleOpportunityTargetSelect(interaction, parts[1], parts[2]);
    } else if (customId.startsWith('cretopp_')) {
        const parts = customId.split('_');
        await turnHandler.handleRetrieveOpponentSelect(interaction, parts[1], parts[2], parts[3]);
    } else if (customId.startsWith('cret_')) {
        const parts = customId.split('_');
        await turnHandler.handleRetrieveWeaponSelect(interaction, parts[1], parts[2]);
    }
    // Target selection for player attacks/skills
    else if (customId.startsWith('ctsa_')) {
        const parts = customId.split('_');
        const sessionId = parts[1];
        const actorIdFromCustomId = parts[2];
        const maneuverIdFromCustomId = parts[3] || 'null';
        await turnHandler.handleCombatTargetSelectAttack(
            interaction,
            sessionId,
            actorIdFromCustomId,
            maneuverIdFromCustomId
        );
    }
    // Skill/maneuver selection
    else if (customId.startsWith('csm_')) {
        const parts = customId.split('_');
        const sessionId = parts[1];
        const actorId = parts[2];
        await turnHandler.handleCombatSkillManeuverSelect(interaction, sessionId, actorId);
    }
    // NPC maneuver selection
    else if (customId.startsWith('npc_skill_pick_')) {
        const parts = customId.split('_');
        await npcHandler.handleDmNpcSkillSelect(interaction, parts[3], parts[4]);
    }
    // NPC maneuver target selection
    else if (customId.startsWith('npc_skill_target_')) {
        const parts = customId.split('_');
        await npcHandler.handleDmNpcSkillTargetSelect(interaction, parts[3], parts[4]);
    }
    // NPC target selection
    else if (customId.startsWith('cts_npc_')) {
        const parts = customId.split('_');
        if (parts.length === 4) {
            const sessionId = parts[2];
            const actorId = parts[3];
            await npcHandler.handleDmNpcTargetSelectAttack(interaction, sessionId, actorId);
        } else {
            log.error({ customId }, 'Invalid cts_npc_ customId format');
            await interaction
                .update({ content: 'Error: Invalid NPC target selection data.', components: [] })
                .catch(() => {});
        }
    }
    // Resume session
    else if (customId.startsWith('resume_session_select')) {
        await turnHandler.handleResumeSessionSelect(interaction);
    }
    // Remove participant
    else if (customId.startsWith('remove_participant_select_')) {
        const sessionId = customId.substring('remove_participant_select_'.length);
        await setupHandler.handleRemoveParticipantSelectInteraction(interaction, sessionId);
    } else {
        log.warn({ customId }, 'Unknown select menu prefix');
    }
}

/**
 * Routes modal submit interactions to appropriate handlers based on customId prefix.
 */
async function handleCombatModalSubmit(interaction) {
    const customId = interaction.customId;
    log.debug({ customId, userId: interaction.user.id }, 'Routing modal submit');

    if (customId.startsWith('add_mob_submit_')) {
        const sessionId = customId.substring('add_mob_submit_'.length);
        await setupHandler.handleAddMobSubmitInteraction(interaction, sessionId);
    } else if (customId.startsWith('cmodal_')) {
        const parts = customId.split('_');
        await turnHandler.handleCombatActionModal(interaction, parts[1], parts[2], parts[3]);
    } else {
        log.warn({ customId }, 'Unknown modal submit prefix');
    }
}

// Re-export utilities needed by other modules (like index.js recovery)
module.exports = {
    // Router functions
    handleCombatButton,
    handleCombatSelectMenu,
    handleCombatModalSubmit,
    // Re-export utilities from domain handlers for backward compatibility
    updateCombatDisplay: turnHandler.updateCombatDisplay,
    getOrLoadSession: turnHandler.getOrLoadSession,
    addLogEntry: turnHandler.addLogEntry,
    nextTurn: turnHandler.nextTurn,
    createCombatEmbed: turnHandler.createCombatEmbed,
    createPlayerActionRow: turnHandler.createPlayerActionRow,
};
