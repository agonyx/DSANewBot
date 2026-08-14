/**
 * NPC Handler
 * Handles DM-controlled NPC actions during combat:
 * - NPC attack actions
 * - NPC skill actions
 * - NPC target selection
 */

const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { ButtonBuilder } = require('@discordjs/builders');

const { createLogger } = require('../utils/logger');
const { getOrLoadSession, resolveCombatAction, createManagementActionRow } = require('./combatTurnHandler');
const { db } = require('../db');
const { actionModifications } = require('../db/schema');

const log = createLogger('npc-handler');

/**
 * Creates Action Rows with buttons for the DM to control an NPC's turn.
 * @param {string} sessionId - The combat session ID.
 * @param {string} npcActorId - The combatant ID of the NPC whose turn it is.
 * @returns {ActionRowBuilder[]}
 */
function createNpcDmActionRow(sessionId, npcActorId) {
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`dmnpc_action_attack_${sessionId}_${npcActorId}`)
            .setLabel('NPC Attack')
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ name: '⚔️' }),
        new ButtonBuilder()
            .setCustomId(`dmnpc_action_skill_${sessionId}_${npcActorId}`)
            .setLabel('NPC Skill/Action')
            .setStyle(ButtonStyle.Primary)
            .setEmoji({ name: '✨' }),
        new ButtonBuilder()
            .setCustomId(`dmnpc_action_endturn_${sessionId}_${npcActorId}`)
            .setLabel('NPC End Turn')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji({ name: '⏩' })
    );

    const managementRow = createManagementActionRow(sessionId);

    return [actionRow, managementRow];
}

/**
 * Handles the DM's click on the "NPC Attack" button.
 * @param {ButtonInteraction} interaction - The button interaction.
 * @param {string} sessionId - The combat session ID.
 * @param {string} actorId - The combatant ID of the NPC initiating the attack.
 */
async function handleDmNpcAttackAction(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling DM NPC Attack Action');

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (deferError) {
        log.error({ error: deferError.message }, 'Failed to defer reply');
        return;
    }

    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);

        if (!sessionData || sessionData.id !== sessionId) {
            return interaction.editReply({ content: '❌ Error: Could not find active combat data.' });
        }
        if (sessionData.dmUserId !== interaction.user.id) {
            return interaction.editReply({ content: '❌ Only the DM can control NPC actions.' });
        }
        if (sessionData.state !== 'RUNNING') {
            return interaction.editReply({ content: `❌ Cannot attack: Combat is not running.` });
        }

        const activeCombatantId = sessionData.turnOrder?.[sessionData.currentTurnIndex];
        const actorCombatant = sessionData.combatants?.find(c => c.id === actorId);

        if (!actorCombatant) {
            return interaction.editReply({ content: `❌ Error: Cannot find the NPC's combatant data.` });
        }

        log.debug({ npcName: actorCombatant.name, allegiance: actorCombatant.allegiance }, 'NPC attacker info');

        if (actorId !== activeCombatantId) {
            const active = sessionData.combatants?.find(c => c.id === activeCombatantId);
            return interaction.editReply({
                content: `❌ It's not this NPC's turn! It's **${active?.name || 'Unknown'}**'s turn.`,
            });
        }

        log.debug({ npcName: actorCombatant.name, allegiance: actorCombatant.allegiance }, 'Finding targets');
        const potentialTargets = sessionData.combatants?.filter(c => {
            const isTarget = c.id !== actorId && c.currentHP > 0 && c.allegiance !== actorCombatant.allegiance;
            log.debug({ targetName: c.name, allegiance: c.allegiance, hp: c.currentHP, isTarget }, 'Checking target');
            return isTarget;
        });

        if (!potentialTargets || potentialTargets.length === 0) {
            return interaction.editReply({ content: 'ℹ️ No valid targets available for the NPC to attack!' });
        }

        log.debug({ targetCount: potentialTargets.length }, 'Valid targets found');

        const targetOptions = potentialTargets.map(target =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`${target.name} (${target.currentHP}/${target.maxHP} HP)`.substring(0, 100))
                .setValue(target.id)
        );

        const targetSelectMenu = new StringSelectMenuBuilder()
            .setCustomId(`cts_npc_${sessionId}_${actorId}`)
            .setPlaceholder('Choose a target for the NPC to attack...')
            .addOptions(targetOptions.slice(0, 25));

        const row = new ActionRowBuilder().addComponents(targetSelectMenu);

        await interaction.editReply({
            content: `**DM Action:** Choose a target for **${actorCombatant.name}** to attack!`,
            components: [row],
        });

        log.info({ sessionId, actorId }, 'Target selection presented to DM');
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId }, 'Error in handleDmNpcAttackAction');
        await interaction
            .editReply({ content: '❌ An error occurred while preparing the NPC attack.', components: [] })
            .catch(() => {});
    }
}

/**
 * Handles the DM's target selection for an NPC attack.
 * @param {StringSelectMenuInteraction} interaction - The select menu interaction.
 * @param {string} sessionId - The combat session ID.
 * @param {string} actorId - The combatant ID of the NPC attacker.
 */
async function handleDmNpcTargetSelectAttack(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling DM NPC Target Select Attack');
    await interaction.deferUpdate({ ephemeral: true });

    const targetId = interaction.values[0];
    const { client, channelId } = interaction;

    const sessionData = client.activeCombats.get(channelId);

    if (!sessionData || sessionData.id !== sessionId) {
        return interaction.followUp({ content: '❌ Error: Active combat data not found!', ephemeral: true });
    }
    if (sessionData.dmUserId !== interaction.user.id) {
        return interaction.followUp({ content: '❌ Not the DM for this combat.', ephemeral: true });
    }

    const attacker = sessionData.combatants.find(c => c.id === actorId);
    const target = sessionData.combatants.find(c => c.id === targetId);
    const activeCombatantId = sessionData.turnOrder[sessionData.currentTurnIndex];

    if (actorId !== activeCombatantId) {
        return interaction.followUp({ content: `❌ It's not this NPC's turn!`, ephemeral: true });
    }
    if (!attacker || !target) {
        return interaction.followUp({ content: `❌ Attacker/Target data missing.`, ephemeral: true });
    }

    try {
        log.debug({ sessionId, actorId, targetId }, 'Resolving NPC combat action');
        await resolveCombatAction(client, channelId, sessionId, actorId, targetId, null, {
            callerDiscordId: interaction.user.id,
        });

        await interaction.editReply({ content: `✅ Attack by **${attacker.name}** resolved.`, components: [] });

        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete ephemeral confirmation');
            });
        }, 5000);
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId, targetId }, 'Error resolving NPC attack');
        await interaction.followUp({
            content: '❌ An error occurred while resolving the NPC attack.',
            ephemeral: true,
        });
    }
}

/**
 * Handles the DM's click on the "NPC Skill/Action" button.
 * @param {ButtonInteraction} interaction - The button interaction.
 * @param {string} sessionId - The combat session ID.
 * @param {string} actorId - The combatant ID of the NPC.
 */
async function handleDmNpcSkillAction(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling DM NPC Skill Action');
    await interaction.deferReply({ ephemeral: true });
    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    if (!sessionData || sessionData.id !== sessionId) {
        return interaction.editReply('❌ Active combat not found.');
    }
    if (sessionData.dmUserId !== interaction.user.id) {
        return interaction.editReply('❌ Only the combat DM may control NPCs.');
    }
    if (sessionData.turnOrder[sessionData.currentTurnIndex] !== actorId) {
        return interaction.editReply("❌ It's not this NPC's turn.");
    }
    const maneuvers = await db.select().from(actionModifications).orderBy(actionModifications.name);
    const usable = maneuvers.filter(maneuver => ['MELEE', 'RANGED'].includes(maneuver.action_type));
    if (usable.length === 0) return interaction.editReply('ℹ️ No combat maneuvers are available.');
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`npc_skill_pick_${sessionId}_${actorId}`)
        .setPlaceholder('Choose an NPC maneuver...')
        .addOptions(
            usable.slice(0, 25).map(maneuver =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(maneuver.name.substring(0, 100))
                    .setDescription((maneuver.description || 'Combat maneuver').substring(0, 100))
                    .setValue(maneuver.id)
            )
        );
    return interaction.editReply({
        content: 'Choose the NPC maneuver:',
        components: [new ActionRowBuilder().addComponents(menu)],
    });
}

async function handleDmNpcSkillSelect(interaction, sessionId, actorId) {
    const maneuverId = interaction.values[0];
    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    if (!sessionData || sessionData.id !== sessionId || sessionData.dmUserId !== interaction.user.id) {
        return interaction.update({ content: '❌ Combat session or DM authorization is invalid.', components: [] });
    }
    const actor = sessionData.combatants.find(combatant => combatant.id === actorId);
    const targets = sessionData.combatants.filter(
        combatant => combatant.id !== actorId && combatant.currentHP > 0 && combatant.allegiance !== actor?.allegiance
    );
    if (!actor || targets.length === 0) {
        return interaction.update({ content: 'ℹ️ No valid NPC maneuver target.', components: [] });
    }
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`npc_skill_target_${sessionId}_${actorId}`)
        .setPlaceholder('Choose the NPC maneuver target...')
        .addOptions(
            targets
                .slice(0, 25)
                .map(target =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${target.name} (${target.currentHP}/${target.maxHP} HP)`.substring(0, 100))
                        .setValue(`${target.id}:${maneuverId}`)
                )
        );
    return interaction.update({
        content: `Choose a target for **${actor.name}**:`,
        components: [new ActionRowBuilder().addComponents(menu)],
    });
}

async function handleDmNpcSkillTargetSelect(interaction, sessionId, actorId) {
    await interaction.deferUpdate();
    const [targetId, maneuverId] = interaction.values[0].split(':');
    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    if (!sessionData || sessionData.id !== sessionId || sessionData.dmUserId !== interaction.user.id) {
        return interaction.followUp({ content: '❌ Combat session or DM authorization is invalid.', ephemeral: true });
    }
    await resolveCombatAction(interaction.client, interaction.channelId, sessionId, actorId, targetId, maneuverId, {
        callerDiscordId: interaction.user.id,
    });
    return interaction.editReply({ content: '✅ NPC maneuver resolved.', components: [] });
}

module.exports = {
    createNpcDmActionRow,
    handleDmNpcAttackAction,
    handleDmNpcTargetSelectAttack,
    handleDmNpcSkillAction,
    handleDmNpcSkillSelect,
    handleDmNpcSkillTargetSelect,
};
