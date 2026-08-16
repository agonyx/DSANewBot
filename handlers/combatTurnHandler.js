/**
 * Combat Turn Handler
 * Handles all turn-based combat interactions:
 * - Attack/skill actions
 * - Target selection
 * - Combat resolution
 * - Turn management
 * - Combat display
 */

const {
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ActionRowBuilder,
    ButtonStyle,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { ButtonBuilder } = require('@discordjs/builders');

const { db } = require('../db');
const { eq, and, inArray } = require('drizzle-orm');
const { combatSessions, combatants, players, stats, weapons, mobs } = require('../db/schema');
const { combatantToMemory, sessionToMemory } = require('../utils/transforms');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const {
    buildCombatComponentPayload,
    editComponentMessage,
    messageUsesComponentsV2,
} = require('../utils/componentViews');
const {
    calculatePainLevel,
    getConditionEmoji,
    getStatusEmoji,
    CONDITION_LABELS,
    STATUS_LABELS,
} = require('../utils/conditionUtils');

const log = createLogger('combat-turn');
const {
    beginAttackAction,
    resolvePendingAttack,
    getPendingAttack,
    getCombatActionMenu,
    getAvailableCombatManeuvers,
    recordGenericCombatAction,
    spendCombatResource,
    retrieveDroppedWeapon,
    takeFullDefense,
    reloadAction,
    escapeGrapple,
    standUp,
    resolveTwoWeaponAttackAction,
    advanceTurn,
    endCombatSession,
    parkCombat,
    resumeCombat,
    getCombatSession,
} = require('../services/combat');
const { castAbility, listLearnedSpells, listLearnedLiturgies } = require('../services/supernatural');

function assertInteractionControlsActor(sessionData, actorId, userId) {
    const actor = sessionData?.combatants?.find(combatant => combatant.id === actorId);
    if (!actor) throw new Error('Combatant not found.');
    const activeId = sessionData.turnOrder?.[sessionData.currentTurnIndex];
    if (activeId !== actorId) throw new Error("It is not this combatant's turn.");
    if (actor.type === 'PLAYER' && actor.discordUserId !== userId)
        throw new Error('You cannot control this character.');
    if (actor.type === 'NPC' && sessionData.dmUserId !== userId) throw new Error('Only the combat DM controls NPCs.');
    return actor;
}

function combatTargetMenu(customId, sessionData, actor, { maxValues = 1 } = {}) {
    const targets = sessionData.combatants.filter(
        combatant => combatant.id !== actor.id && combatant.currentHP > 0 && combatant.allegiance !== actor.allegiance
    );
    if (!targets.length) return null;
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(maxValues > 1 ? 'Choose one or two combatants…' : 'Choose a combatant…')
            .setMinValues(1)
            .setMaxValues(Math.min(maxValues, targets.length))
            .addOptions(
                targets.map(target => ({
                    label: `${target.name} (${target.currentHP}/${target.maxHP} HP)`.slice(0, 100),
                    value: target.id,
                }))
            )
    );
}

async function handleCombatActionMenuSelect(interaction, sessionId, actorId) {
    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    try {
        const actor = assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const action = interaction.values[0];
        if (action === 'ATTACK') return handleCombatActionAttack(interaction, sessionId, actorId);
        if (action === 'MANEUVER') return handleCombatActionSkill(interaction, sessionId, actorId);
        if (action === 'END_TURN') return handleCombatEndTurnInteraction(interaction, sessionId, actorId);

        if (['GENERIC', 'FREE', 'RESOURCE'].includes(action)) {
            const modal = new ModalBuilder()
                .setCustomId(`cmodal_${sessionId}_${actorId}_${action}`)
                .setTitle(
                    action === 'RESOURCE' ? 'Spend a resource' : action === 'FREE' ? 'Free action' : 'Generic action'
                );
            if (action === 'RESOURCE') {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('resource_type')
                            .setLabel('Resource: asp, kap, or schicksalspunkte')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(20)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('amount')
                            .setLabel('Amount')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(4)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reason')
                            .setLabel('Reason')
                            .setStyle(TextInputStyle.Paragraph)
                            .setMaxLength(240)
                            .setRequired(true)
                    )
                );
            } else {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('description')
                            .setLabel(action === 'FREE' ? 'Movement or free action' : 'What does the character do?')
                            .setStyle(TextInputStyle.Paragraph)
                            .setMaxLength(240)
                            .setRequired(true)
                    )
                );
            }
            return interaction.showModal(modal);
        }

        if (action === 'SPELL' || action === 'LITURGY') {
            await interaction.deferReply({ ephemeral: true });
            if (actor.type !== 'PLAYER') return interaction.editReply('❌ NPC spell inventories are not modeled yet.');
            const learned =
                action === 'SPELL'
                    ? (await listLearnedSpells({ discordId: interaction.user.id }, { playerId: actor.playerId })).map(
                          row => row.spell
                      )
                    : (
                          await listLearnedLiturgies({ discordId: interaction.user.id }, { playerId: actor.playerId })
                      ).map(row => row.liturgy);
            if (!learned.length) return interaction.editReply(`ℹ️ No learned ${action.toLowerCase()} entries.`);
            const picker = new StringSelectMenuBuilder()
                .setCustomId(`cabil_${action}_${sessionId}_${actorId}`)
                .setPlaceholder(`Choose ${action.toLowerCase()}…`)
                .addOptions(
                    learned.slice(0, 25).map(ability => ({
                        label: ability.name.slice(0, 100),
                        description:
                            `${ability.resource_cost} ${action === 'SPELL' ? 'AsP' : 'KaP'} · ${ability.casting_time || 'Immediate'}`.slice(
                                0,
                                100
                            ),
                        value: ability.id,
                    }))
                );
            return interaction.editReply({
                content: `Choose a learned ${action.toLowerCase()}.`,
                components: [new ActionRowBuilder().addComponents(picker)],
            });
        }

        if (action === 'TWO_WEAPON' || action === 'OPPORTUNITY') {
            await interaction.deferReply({ ephemeral: true });
            const row = combatTargetMenu(
                `${action === 'TWO_WEAPON' ? 'ctw' : 'cop'}_${sessionId}_${actorId}`,
                sessionData,
                actor,
                { maxValues: action === 'TWO_WEAPON' ? 2 : 1 }
            );
            return interaction.editReply(
                row ? { content: 'Choose combatant target(s).', components: [row] } : 'ℹ️ No valid enemy combatants.'
            );
        }

        if (action === 'RETRIEVE') {
            await interaction.deferReply({ ephemeral: true });
            if (!actor.playerId) return interaction.editReply('❌ NPC dropped equipment is not modeled yet.');
            const dropped = await db
                .select({ id: weapons.id, name: weapons.name })
                .from(weapons)
                .where(
                    and(
                        eq(weapons.player_id, actor.playerId),
                        eq(weapons.is_dropped, true),
                        eq(weapons.dropped_session_id, sessionId)
                    )
                );
            if (!dropped.length) return interaction.editReply('ℹ️ No dropped weapon is available.');
            const picker = new StringSelectMenuBuilder()
                .setCustomId(`cret_${sessionId}_${actorId}`)
                .setPlaceholder('Choose the dropped weapon…')
                .addOptions(
                    dropped.slice(0, 25).map(weapon => ({ label: weapon.name.slice(0, 100), value: String(weapon.id) }))
                );
            return interaction.editReply({
                content: 'Choose a weapon to retrieve.',
                components: [new ActionRowBuilder().addComponents(picker)],
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        if (action === 'FULL_DEFENSE') await takeFullDefense(ctx, { sessionId, combatantId: actorId });
        else if (action === 'RELOAD') await reloadAction(ctx, { sessionId, combatantId: actorId });
        else if (action === 'STAND_UP') await standUp(ctx, { sessionId, combatantId: actorId });
        else if (action === 'ESCAPE_GRAPPLE') await escapeGrapple(ctx, { sessionId, combatantId: actorId });
        else throw new Error('Unknown combat action.');
        await nextTurn(interaction.client, interaction.channelId);
        return interaction.editReply(`✅ ${action.replaceAll('_', ' ').toLowerCase()} resolved.`);
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId }, 'Combat action menu failed');
        const payload = { content: `❌ ${error.data?.error || error.message}`, ephemeral: true };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.reply(payload);
    }
}

async function handleCombatAbilitySelect(interaction, abilityType, sessionId, actorId) {
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const abilityId = interaction.values[0];
        const options = sessionData.combatants
            .filter(combatant => combatant.currentHP > 0)
            .slice(0, 25)
            .map(combatant => ({ label: combatant.name.slice(0, 100), value: combatant.id }));
        const picker = new StringSelectMenuBuilder()
            .setCustomId(`cabt_${abilityType}_${sessionId}_${actorId}_${abilityId}`)
            .setPlaceholder('Choose the target combatant…')
            .addOptions(options);
        return interaction.update({
            content: `Choose a target for the ${abilityType.toLowerCase()}. Default modifiers and listed resource cost will be used.`,
            components: [new ActionRowBuilder().addComponents(picker)],
        });
    } catch (error) {
        return interaction.update({ content: `❌ ${error.message}`, components: [] });
    }
}

async function handleCombatAbilityTarget(interaction, abilityType, sessionId, actorId, abilityId) {
    await interaction.update({ content: `Resolving ${abilityType.toLowerCase()}…`, components: [] });
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        const actor = assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const result = await castAbility(
            { discordId: interaction.user.id },
            {
                abilityType,
                abilityId,
                modifier: 0,
                targetCombatantId: interaction.values[0],
                casterPlayerId: actor.playerId,
            }
        );
        await nextTurn(interaction.client, interaction.channelId);
        return interaction.editReply(
            `${result.success ? '✅' : '❌'} **${result.ability.name}**: QS ${result.qualityLevel}; ` +
                `${result.paidCost} ${abilityType === 'SPELL' ? 'AsP' : 'KaP'} spent.`
        );
    } catch (error) {
        log.error({ error: error.message, abilityType, abilityId }, 'Combat supernatural action failed');
        return interaction.editReply(`❌ ${error.data?.error || error.message}`);
    }
}

async function handleTwoWeaponTargetSelect(interaction, sessionId, actorId) {
    await interaction.update({ content: 'Resolving two-weapon attack…', components: [] });
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const result = await resolveTwoWeaponAttackAction(
            { discordId: interaction.user.id },
            { sessionId, attackerId: actorId, targetIds: [interaction.values[0], interaction.values[1]] }
        );
        if (result.status === 'PENDING') {
            await updateCombatDisplay(interaction.client, interaction.channelId);
            return interaction.editReply(
                result.attacks.length
                    ? 'Main-hand attack resolved; waiting for the second defender choice.'
                    : 'Main-hand attack hit; waiting for the defender choice.'
            );
        }
        await nextTurn(interaction.client, interaction.channelId);
        return interaction.editReply(
            result.attacks
                .map(
                    (attack, index) =>
                        `${index ? 'Off hand' : 'Main hand'} vs ${attack.target.name}: ${attack.hitConnected ? `${attack.finalDamage + attack.zoneDamage} damage` : 'no hit'}`
                )
                .join('\n')
        );
    } catch (error) {
        return interaction.editReply(`❌ ${error.data?.error || error.message}`);
    }
}

async function handleOpportunityTargetSelect(interaction, sessionId, actorId) {
    await interaction.update({ content: 'Resolving opportunity attack…', components: [] });
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const result = await resolveCombatAction(
            interaction.client,
            interaction.channelId,
            sessionId,
            actorId,
            interaction.values[0],
            null,
            { callerDiscordId: interaction.user.id, attackKind: 'opportunity', advanceTurn: false }
        );
        return interaction.editReply(
            result.status === 'PENDING' ? 'Waiting for defense.' : `✅ Opportunity attack resolved.`
        );
    } catch (error) {
        return interaction.editReply(`❌ ${error.data?.error || error.message}`);
    }
}

async function handleRetrieveWeaponSelect(interaction, sessionId, actorId) {
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        const actor = assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const opponents = sessionData.combatants.filter(
            combatant => combatant.currentHP > 0 && combatant.allegiance !== actor.allegiance
        );
        const picker = new StringSelectMenuBuilder()
            .setCustomId(`cretopp_${sessionId}_${actorId}_${interaction.values[0]}`)
            .setPlaceholder('Choose a nearby opponent, if any…')
            .addOptions([
                { label: 'No opponent nearby', value: 'NONE' },
                ...opponents.slice(0, 24).map(opponent => ({ label: opponent.name.slice(0, 100), value: opponent.id })),
            ]);
        return interaction.update({
            content: 'A failed retrieval grants the selected nearby opponent an opportunity attack.',
            components: [new ActionRowBuilder().addComponents(picker)],
        });
    } catch (error) {
        return interaction.update({ content: `❌ ${error.message}`, components: [] });
    }
}

async function handleRetrieveOpponentSelect(interaction, sessionId, actorId, weaponId) {
    await interaction.update({ content: 'Attempting retrieval…', components: [] });
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        const result = await retrieveDroppedWeapon(
            { discordId: interaction.user.id },
            {
                sessionId,
                combatantId: actorId,
                weaponId: Number(weaponId),
                opponentId: interaction.values[0] === 'NONE' ? null : interaction.values[0],
            }
        );
        await nextTurn(interaction.client, interaction.channelId);
        return interaction.editReply(
            `${result.success ? '✅ Weapon retrieved.' : '❌ Retrieval failed.'} Rolls: ${result.rolls.join('/')} (remaining FtW ${result.remainingFtw}).`
        );
    } catch (error) {
        return interaction.editReply(`❌ ${error.data?.error || error.message}`);
    }
}

async function handleCombatActionModal(interaction, sessionId, actorId, action) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        assertInteractionControlsActor(sessionData, actorId, interaction.user.id);
        if (action === 'RESOURCE') {
            const type = interaction.fields.getTextInputValue('resource_type').trim().toLowerCase();
            if (!['asp', 'kap', 'schicksalspunkte'].includes(type))
                throw new Error('Resource must be asp, kap, or schicksalspunkte.');
            const amount = Number(interaction.fields.getTextInputValue('amount'));
            const result = await spendCombatResource(
                { discordId: interaction.user.id },
                {
                    sessionId,
                    combatantId: actorId,
                    type,
                    amount,
                    reason: interaction.fields.getTextInputValue('reason'),
                }
            );
            await updateCombatDisplay(interaction.client, interaction.channelId);
            return interaction.editReply(
                `✅ Spent ${amount} ${type.toUpperCase()}; ${result.newValue}/${result.max} remain. No action was consumed.`
            );
        }
        const freeAction = action === 'FREE';
        await recordGenericCombatAction(
            { discordId: interaction.user.id },
            {
                sessionId,
                combatantId: actorId,
                description: interaction.fields.getTextInputValue('description'),
                freeAction,
            }
        );
        if (freeAction) await updateCombatDisplay(interaction.client, interaction.channelId);
        else await nextTurn(interaction.client, interaction.channelId);
        return interaction.editReply(`✅ ${freeAction ? 'Free action' : 'Action'} recorded.`);
    } catch (error) {
        return interaction.editReply(`❌ ${error.data?.error || error.message}`);
    }
}

/**
 * Helper to get session data from memory or load from DB if missing.
 */
async function getOrLoadSession(client, channelId) {
    const sessionData = client.activeCombats?.get(channelId);
    if (sessionData) {
        log.debug({ channelId }, 'Found session in memory');
        return sessionData;
    }

    log.debug({ channelId }, 'Session not in memory, loading from DB');
    const [session] = await db
        .select()
        .from(combatSessions)
        .where(and(eq(combatSessions.channel_id, channelId), inArray(combatSessions.state, ['RUNNING', 'PAUSED'])))
        .limit(1);

    if (!session) {
        log.error({ channelId }, 'Failed to load session from DB');
        return null;
    }

    const combatantRows = await db.select().from(combatants).where(eq(combatants.session_id, session.id));
    session.combatants = combatantRows;

    const memorySession = sessionToMemory(session);
    client.activeCombats.set(channelId, memorySession);
    log.info({ sessionId: session.id, channelId }, 'Session loaded from DB');
    return memorySession;
}

/**
 * Handles the click on the "Attack" action button during combat.
 */
async function handleCombatActionAttack(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling Attack Action');
    await interaction.deferReply({ ephemeral: true });

    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        if (!sessionData || sessionData.id !== sessionId) {
            return interaction.editReply({ content: '❌ Error: Could not find active combat data.' });
        }
        if (sessionData.state !== 'RUNNING') {
            return interaction.editReply({ content: `❌ Cannot attack: Combat is not running.` });
        }

        const actorCombatant = sessionData.combatants?.find(c => c.id === actorId);
        if (!actorCombatant) {
            return interaction.editReply({ content: `❌ Error: Cannot find your combatant data.` });
        }

        const potentialTargets = sessionData.combatants?.filter(
            c => c.id !== actorId && c.currentHP > 0 && c.allegiance !== actorCombatant.allegiance
        );
        if (!potentialTargets || potentialTargets.length === 0) {
            return interaction.editReply({ content: 'ℹ️ No valid targets available to attack!' });
        }

        const targetOptions = potentialTargets.map(target => ({
            label: `${target.name} (${target.currentHP}/${target.maxHP} HP)`.substring(0, 100),
            value: target.id,
        }));

        const targetSelectMenu = new StringSelectMenuBuilder()
            .setCustomId(`ctsa_${sessionId}_${actorId}_null`)
            .setPlaceholder('Choose a target to attack...')
            .addOptions(targetOptions);

        const row = new ActionRowBuilder().addComponents(targetSelectMenu);

        await interaction.editReply({
            content: `**${actorCombatant.name}'s Turn:** Choose a target for your attack!`,
            components: [row],
        });
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId }, 'Error in handleCombatActionAttack');
        await interaction.editReply({ content: '❌ An error occurred while preparing your attack.' }).catch(() => {});
    }
}

/**
 * Handles the click on the "Skill/Action" button during combat.
 */
async function handleCombatActionSkill(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling Skill Action');
    await interaction.deferReply({ ephemeral: true });

    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        if (!sessionData) {
            return interaction.editReply('❌ Could not find active combat data.');
        }

        const actorCombatant = sessionData.combatants.find(c => c.id === actorId);
        if (!actorCombatant || actorCombatant.type !== 'PLAYER') {
            return interaction.editReply('❌ Invalid actor for this action.');
        }

        const evaluated = await getAvailableCombatManeuvers(
            { discordId: interaction.user.id },
            { sessionId, combatantId: actorId }
        );
        const availableSkills = evaluated.filter(entry => entry.eligibility.available).map(entry => entry.maneuver);

        if (!availableSkills || availableSkills.length === 0) {
            const reasons = evaluated
                .slice(0, 8)
                .map(entry => `${entry.maneuver.name}: ${entry.eligibility.reasonCode}`)
                .join('\n');
            return interaction.editReply(
                reasons
                    ? `ℹ️ No learned maneuver is valid for the equipped weapon/current state.\n${reasons}`
                    : 'ℹ️ You have no learned combat maneuvers.'
            );
        }

        const skillOptions = availableSkills.map(skill => ({
            label: skill.name,
            description:
                `AT: ${skill.rules?.at_modifier || 0}, PA: ${skill.rules?.opponent_pa_modifier || 0}, DMG: ${skill.rules?.damage_bonus || 0}`.substring(
                    0,
                    100
                ),
            value: String(skill.id),
        }));

        const skillSelectMenu = new StringSelectMenuBuilder()
            .setCustomId(`csm_${sessionId}_${actorId}`)
            .setPlaceholder('Choose a skill/maneuver to use...')
            .addOptions(skillOptions);

        const row = new ActionRowBuilder().addComponents(skillSelectMenu);

        await interaction.editReply({
            content: `**${actorCombatant.name}'s Turn:** Choose a skill to perform.`,
            components: [row],
        });
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId }, 'Error in handleCombatActionSkill');
        await interaction.editReply({ content: '❌ An error occurred while fetching your skills.' }).catch(() => {});
    }
}

/**
 * Handles the "End Turn" button click (Player or DM-controlled NPC).
 */
async function handleCombatEndTurnInteraction(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId, userId: interaction.user.id }, 'Handling End Turn');
    await interaction.deferUpdate();

    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    if (!sessionData || sessionData.id !== sessionId || sessionData.state !== 'RUNNING') {
        log.error({ sessionId }, 'Session not running or ID mismatch');
        return;
    }

    const activeCombatantId = sessionData.turnOrder?.[sessionData.currentTurnIndex];
    const actorCombatant = sessionData.combatants?.find(c => c.id === actorId);

    if (!actorCombatant) {
        log.error({ actorId }, 'Actor not found');
        return;
    }

    if (actorId !== activeCombatantId) {
        log.debug({ actorId, activeCombatantId }, 'Not actor turn');
        await interaction
            .followUp({
                content: `❌ It's not your (${actorCombatant.name}'s) turn!`,
                ephemeral: true,
            })
            .catch(() => {});
        return;
    }

    if (actorCombatant.type === 'PLAYER' && actorCombatant.discordUserId !== interaction.user.id) {
        await interaction
            .followUp({
                content: `❌ You cannot end the turn for ${actorCombatant.name}.`,
                ephemeral: true,
            })
            .catch(() => {});
        return;
    }

    if (actorCombatant.type === 'NPC' && sessionData.dmUserId !== interaction.user.id) {
        await interaction
            .followUp({
                content: `❌ Only the DM can end an NPC's turn.`,
                ephemeral: true,
            })
            .catch(() => {});
        return;
    }

    try {
        await nextTurn(interaction.client, interaction.channelId);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error during nextTurn');
        await interaction
            .followUp({
                content: `❌ An error occurred while advancing the turn.`,
                ephemeral: true,
            })
            .catch(() => {});
    }
}

/**
 * Resolves a combat action (attack with or without maneuver).
 */
async function resolveCombatAction(client, channelId, sessionId, actorId, targetId, maneuverId, options = {}) {
    const sessionData = client.activeCombats.get(channelId);
    if (!sessionData) return;

    const attacker = sessionData.combatants.find(c => c.id === actorId);
    const target = sessionData.combatants.find(c => c.id === targetId);
    if (!attacker || !target) return;

    let result;
    try {
        // Delegates to the transactional, DB-source-of-truth service. The service
        // loads effective AT/PA/RS/TP, applies persisted effects and maneuver mods,
        // resolves attack/defense/soak, and mutates combatant HP in one transaction.
        result = await beginAttackAction(
            { discordId: options.callerDiscordId },
            {
                sessionId,
                attackerId: actorId,
                targetId,
                maneuverId: maneuverId && maneuverId !== 'null' ? maneuverId : null,
                attackKind: options.attackKind,
                hitZone: options.hitZone,
                distance: options.distance,
                coverPenalty: options.coverPenalty,
            }
        );
    } catch (error) {
        log.error({ error: error.message, sessionId, actorId, targetId }, 'resolveAttackAction failed');
        throw error;
    }

    if (result.status === 'PENDING') {
        await updateCombatDisplay(client, channelId);
        return result;
    }

    const finalResult = result.result;
    // Sync the in-memory mirror (display cache) from the service result.
    attacker.currentHP = finalResult.attackerHpAfter;
    attacker.wounds = finalResult.attackerWoundsAfter;
    target.currentHP = finalResult.targetHpAfter;
    target.wounds = finalResult.targetWoundsAfter;
    target.defenseCount = finalResult.defenseCountAfter;
    target.lastHitZone = finalResult.hitZone;
    attacker.reloadRemaining = finalResult.attackerReloadRemaining;
    if (!Array.isArray(sessionData.combatLog)) sessionData.combatLog = [];
    sessionData.combatLog.push(finalResult.logMessage);
    if (sessionData.combatLog.length > 20) sessionData.combatLog = sessionData.combatLog.slice(-20);

    if (options.advanceTurn !== false) await nextTurn(client, channelId);
    return result;
}

/**
 * Handles target selection for player combat actions.
 */
async function handleCombatTargetSelectAttack(interaction, sessionId, actorIdFromCustomId, _maneuverIdFromCustomId) {
    log.info({ sessionId }, 'Handling Target Select Attack');
    await interaction.update({ content: `⚔️ Resolving action...`, components: [] });

    try {
        // The target id (and optional maneuver id) travel in the select option's
        // value as "targetId" or "targetId:maneuverId" — stateless, no server-side
        // nonce. Plain attacks send just the target id; maneuver attacks append it.
        const compositeValue = interaction.values[0];
        const [finalTargetId, maneuverId] = compositeValue.split(':');
        const actorId = actorIdFromCustomId;

        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        if (!sessionData || sessionData.id !== sessionId) {
            throw new Error('Active combat data not found or session mismatch.');
        }

        const attacker = sessionData.combatants.find(c => c.id === actorId);
        const target = sessionData.combatants.find(c => c.id === finalTargetId);
        const activeCombatantId = sessionData.turnOrder[sessionData.currentTurnIndex];

        if (actorId !== activeCombatantId) {
            throw new Error("It's not your turn!");
        }
        if (attacker?.type === 'PLAYER' && attacker.discordUserId !== interaction.user.id) {
            throw new Error("You cannot control another player's character.");
        }
        if (!attacker || !target) {
            throw new Error('Attacker or Target data could not be found.');
        }
        if (target.currentHP <= 0) {
            throw new Error(`${target.name} is already defeated!`);
        }

        log.debug({ sessionId, actorId, targetId: finalTargetId, maneuverId }, 'Resolving combat action');
        await resolveCombatAction(
            interaction.client,
            interaction.channelId,
            sessionId,
            actorId,
            finalTargetId,
            maneuverId,
            { callerDiscordId: interaction.user.id }
        );

        await interaction.deleteReply().catch(err => {
            if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete reply');
        });
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error resolving combat action');
        await interaction.followUp({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
    }
}

/**
 * Handles skill/maneuver selection - shows target menu.
 */
async function handleCombatSkillManeuverSelect(interaction, sessionId, actorId) {
    log.info({ sessionId, actorId }, 'Handling Skill Maneuver Select');
    const maneuverId = interaction.values[0];

    const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
    if (!sessionData) {
        await interaction.followUp({ content: '❌ No active combat session found.', ephemeral: true }).catch(() => {});
        return;
    }

    const actorCombatant = sessionData.combatants.find(c => c.id === actorId);
    const potentialTargets = sessionData.combatants.filter(
        c => c.id !== actorId && c.currentHP > 0 && c.allegiance !== actorCombatant.allegiance
    );

    if (!potentialTargets.length) {
        return interaction.update({ content: 'There are no valid targets for this skill.', components: [] });
    }

    // Maneuver id rides in each option's value alongside the target id — no nonce map.
    const targetOptions = potentialTargets.map(target => ({
        label: `${target.name} (${target.currentHP}/${target.maxHP} HP)`.substring(0, 100),
        value: `${target.id}:${maneuverId}`,
    }));

    const targetSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`ctsa_${sessionId}_${actorId}`)
        .setPlaceholder('Choose a target for your maneuver...')
        .addOptions(targetOptions);

    const row = new ActionRowBuilder().addComponents(targetSelectMenu);

    await interaction.update({
        content: `You have chosen your maneuver. Now, select your target:`,
        components: [row],
    });
}

/**
 * Handles the "Show Full Log" button click.
 */
async function handleShowFullLogInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Show Full Log');
    await interaction.deferReply({ ephemeral: true });

    try {
        const [session] = await db
            .select({ combat_log: combatSessions.combat_log })
            .from(combatSessions)
            .where(eq(combatSessions.id, sessionId))
            .limit(1);

        if (!session || !session.combat_log) {
            return interaction.editReply('❌ Could not retrieve combat log.');
        }

        const logContent = session.combat_log.join('\n');
        const attachment = new AttachmentBuilder(Buffer.from(logContent, 'utf-8'), {
            name: `combat_log_${sessionId}.txt`,
        });

        await interaction.editReply({
            content: 'Here is the full combat log:',
            files: [attachment],
        });
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error fetching full combat log');
        await interaction.editReply('❌ An error occurred while fetching the log.');
    }
}

/**
 * Handles the "Park Combat" button click.
 */
async function handleParkCombatInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Park Combat');
    await interaction.deferReply({ ephemeral: true });

    const channelId = interaction.channelId;
    const ctx = { discordId: interaction.user.id };

    try {
        const sessionData = interaction.client.activeCombats.get(channelId);
        if (!sessionData || sessionData.id !== sessionId) {
            return interaction.editReply('❌ Could not find active combat data.');
        }

        let parked;
        try {
            // service.parkCombat validates DM + RUNNING state, transitions to PAUSED.
            parked = await parkCombat(ctx, sessionId);
        } catch (error) {
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }

        sessionData.state = parked.state;
        await updateCombatDisplay(interaction.client, channelId);
        interaction.client.activeCombats.delete(channelId);

        await interaction.editReply('✅ Combat has been paused. Use `/resumecombat` to continue.');
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error parking combat');
        await interaction.editReply('❌ An error occurred while parking the combat.');
    }
}

/**
 * Handles the "End Combat" button click.
 */
async function handleEndCombatInteraction(interaction, sessionId) {
    log.info({ sessionId, userId: interaction.user.id }, 'Handling End Combat');
    await interaction.deferReply({ ephemeral: true });

    const channelId = interaction.channelId;
    const ctx = { discordId: interaction.user.id };

    try {
        const sessionData = interaction.client.activeCombats.get(channelId);
        if (!sessionData || sessionData.id !== sessionId) {
            return interaction.editReply('❌ Could not find active combat data.');
        }

        let ended;
        try {
            // service.endCombatSession validates DM + not-already-ended, clears active
            // flags, transitions to ENDED, appends the log entry.
            ended = await endCombatSession(ctx, { sessionId, reason: 'Ended by the DM.' });
        } catch (error) {
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }

        sessionData.state = ended.state;
        sessionData.combatLog = Array.isArray(ended.combat_log) ? ended.combat_log.slice(-20) : sessionData.combatLog;

        await updateCombatDisplay(interaction.client, channelId);
        interaction.client.activeCombats.delete(channelId);

        await interaction.editReply('✅ Combat has been ended.');
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error ending combat');
        await interaction.editReply('❌ An error occurred while ending the combat.');
    }
}

/**
 * Handles session resume selection.
 */
async function handleResumeSessionSelect(interaction) {
    const sessionId = interaction.values[0];
    log.info({ sessionId, userId: interaction.user.id }, 'Handling Resume Session Select');

    await interaction.deferReply({ ephemeral: true });
    const ctx = { discordId: interaction.user.id };

    try {
        if (interaction.client.activeCombats?.has(interaction.channelId)) {
            return interaction.editReply({ content: '❌ There is already another active combat in this channel.' });
        }

        // service.resumeCombat validates DM + PAUSED state and transitions to RUNNING.
        try {
            await resumeCombat(ctx, sessionId);
        } catch (error) {
            return interaction.editReply({ content: `❌ ${error.data?.error || error.message}` });
        }

        // Load the now-RUNNING session + combatants into the in-memory mirror.
        const { session, combatants: combatantRows } = await getCombatSession(ctx, sessionId);
        session.combatants = combatantRows;
        const memorySession = sessionToMemory(session);

        if (!interaction.client.activeCombats) {
            interaction.client.activeCombats = new Map();
        }
        interaction.client.activeCombats.set(interaction.channelId, memorySession);
        log.info({ sessionId, channelId: interaction.channelId }, 'Session loaded into memory');

        await addLogEntry(interaction.client, interaction.channelId, sessionId, `--- Combat Resumed ---`);
        await updateCombatDisplay(interaction.client, interaction.channelId, memorySession);

        try {
            await interaction.message.delete();
        } catch (deleteError) {
            log.warn({ error: deleteError.message }, 'Could not delete original select menu message');
        }

        await interaction.editReply({ content: '✅ Combat resumed successfully!' });
        setTimeout(() => {
            interaction.deleteReply().catch(err => {
                if (err.code !== 10008) log.warn({ error: err.message }, 'Failed to delete reply');
            });
        }, 3000);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Error resuming session');
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.';
        await interaction.editReply({ content: `❌ ${errorMessage}` }).catch(() => {});
    }
}

/**
 * Adds a log entry to in-memory state and persists to the database.
 */
async function addLogEntry(client, channelId, sessionId, entry) {
    log.debug({ channelId, sessionId, entry }, 'Adding log entry');

    if (client.activeCombats?.has(channelId)) {
        const sessionDataRef = client.activeCombats.get(channelId);
        if (sessionDataRef && typeof sessionDataRef === 'object' && sessionDataRef.id === sessionId) {
            if (!sessionDataRef.combatLog || !Array.isArray(sessionDataRef.combatLog)) {
                sessionDataRef.combatLog = [];
            }
            sessionDataRef.combatLog.push(entry);
            const MAX_LOG_LENGTH = 20;
            if (sessionDataRef.combatLog.length > MAX_LOG_LENGTH) {
                sessionDataRef.combatLog = sessionDataRef.combatLog.slice(-MAX_LOG_LENGTH);
            }
        }
    }

    try {
        const [session] = await db
            .select({ combat_log: combatSessions.combat_log })
            .from(combatSessions)
            .where(eq(combatSessions.id, sessionId))
            .limit(1);

        if (!session) {
            log.error({ sessionId }, 'Failed to fetch current log');
            return;
        }

        const currentLog = session?.combat_log || [];
        const updatedLog = [...currentLog, entry];
        const MAX_LOG_LENGTH_DB = 20;
        const trimmedLog = updatedLog.slice(-MAX_LOG_LENGTH_DB);

        try {
            await db.update(combatSessions).set({ combat_log: trimmedLog }).where(eq(combatSessions.id, sessionId));
        } catch (updateError) {
            log.error({ error: updateError.message, sessionId }, 'Failed to update log in DB');
        }
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'Failed to send log entry to DB');
    }
}

/**
 * Gets effective combat stats for a combatant.
 */
async function getEffectiveCombatStats(combatant) {
    log.debug({ combatantName: combatant?.name, type: combatant?.type }, 'Fetching effective combat stats');

    if (combatant.type === 'PLAYER') {
        try {
            const [player] = await db.select().from(players).where(eq(players.id, combatant.playerId)).limit(1);

            if (!player) {
                throw new Error(`Failed to fetch player data for ID ${combatant.playerId}`);
            }

            const [statRow] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
            const weaponRows = await db.select().from(weapons).where(eq(weapons.player_id, player.id));

            player.stats = statRow;
            player.weapons = weaponRows;

            const statData = Array.isArray(player.stats) ? player.stats[0] : player.stats;
            if (!statData || !player.weapons) {
                throw new Error(`Incomplete player data for ID ${combatant.playerId}`);
            }

            const offensiveWeapon = player.weapons.find(
                w => w.is_equipped === 'Y' && (w.equipped_slot === 'OFFENSE' || w.equipped_slot === 'ADAPTIVE')
            );
            const defensiveWeapon = player.weapons.find(
                w => w.is_equipped === 'Y' && (w.equipped_slot === 'DEFENSE' || w.equipped_slot === 'ADAPTIVE')
            );

            const at = offensiveWeapon ? offensiveWeapon.at : statData.attacke_basis || 8;
            const tp = offensiveWeapon ? offensiveWeapon.tp : '1w6';
            let pa = defensiveWeapon ? defensiveWeapon.pa : statData.parade_basis || 6;
            const rs = statData.ruestungsschutz || 0;

            if (combatant.effects && Array.isArray(combatant.effects)) {
                for (const effect of combatant.effects) {
                    pa += effect.pa_modifier || 0;
                }
            }

            log.debug({ playerName: player.name, at, pa, rs, tp }, 'Player stats resolved');
            return { currentAT: at, currentPA: pa, currentRS: rs, currentTP: tp };
        } catch (error) {
            log.error({ error: error.message, combatantName: combatant.name }, 'Failed to fetch player stats');
            return { currentAT: 8, currentPA: 6, currentRS: 0, currentTP: '1w6' };
        }
    } else if (combatant.type === 'NPC') {
        try {
            const [mob] = await db.select().from(mobs).where(eq(mobs.id, combatant.mobDefinitionId)).limit(1);

            if (!mob) {
                throw new Error(`Mob definition not found for ID ${combatant.mobDefinitionId}`);
            }

            let pa = mob.base_parry_value;
            if (combatant.effects && Array.isArray(combatant.effects)) {
                for (const effect of combatant.effects) {
                    pa += effect.pa_modifier || 0;
                }
            }

            const stats = {
                currentAT: mob.base_attack_value,
                currentPA: pa,
                currentRS: mob.base_armor_soak,
                currentTP: mob.base_damage_tp,
            };

            log.debug({ mobName: mob.name, ...stats }, 'NPC stats resolved');
            return stats;
        } catch (error) {
            log.error({ error: error.message, combatantName: combatant.name }, 'Failed to fetch mob stats');
            return { currentAT: 8, currentPA: 6, currentRS: 0, currentTP: '1w6' };
        }
    }

    log.warn({ combatantName: combatant.name, type: combatant.type }, 'Unknown combatant type');
    return { currentAT: 0, currentPA: 0, currentRS: 0, currentTP: '1w6' };
}

/**
 * Advances the combat turn to the next non-defeated combatant.
 */
async function nextTurn(client, channelId) {
    log.debug({ channelId }, 'Attempting to advance turn');

    if (!client.activeCombats?.has(channelId)) {
        log.error({ channelId }, 'No active combat found');
        return;
    }

    const sessionData = client.activeCombats.get(channelId);
    if (!sessionData || !Array.isArray(sessionData.turnOrder) || sessionData.turnOrder.length === 0) {
        log.error({ channelId }, 'Invalid session data or empty turn order');
        return;
    }
    if (sessionData.state !== 'RUNNING') {
        log.warn({ channelId }, 'Combat not running, turn cannot advance');
        return;
    }

    const sessionId = sessionData.id;

    let result;
    try {
        // Delegates turn advancement (next conscious combatant, victory/draw detection,
        // round bump, active-flag + log update) to the transactional service. The bot
        // auto-advances after each action, so authorize as the session DM.
        result = await advanceTurn({ discordId: sessionData.dmUserId }, sessionId);
    } catch (error) {
        log.error({ error: error.message, sessionId }, 'service.advanceTurn failed');
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            await channel.send('⚠️ **Warning:** failed to advance the combat turn.').catch(() => {});
        }
        return;
    }

    // Sync the in-memory mirror (display cache) from the service result.
    sessionData.state = result.session.state;
    sessionData.currentTurnIndex = result.ended ? -1 : (result.session.current_turn_index ?? -1);
    sessionData.currentRound = result.session.current_round ?? sessionData.currentRound ?? 1;
    sessionData.combatLog = Array.isArray(result.session.combat_log)
        ? result.session.combat_log.slice(-20)
        : sessionData.combatLog || [];
    sessionData.combatants = result.combatants.map(combatantToMemory);

    await updateCombatDisplay(client, channelId);
}

/**
 * Creates an ASCII health bar.
 * @param {number} currentHP - Current health points.
 * @param {number} maxHP - Maximum health points.
 * @param {number} length - The number of segments for the bar.
 * @returns {string} The formatted health bar string.
 */
function createHealthBar(currentHP, maxHP, length = 5) {
    if (maxHP <= 0) return 'HP [-----] ?/?';
    const percentage = Math.max(0, Math.min(1, currentHP / maxHP));
    const filledSegments = Math.round(percentage * length);
    const emptySegments = length - filledSegments;

    const bar = '█'.repeat(filledSegments) + '-'.repeat(emptySegments);

    return `HP [${bar}] ${currentHP}/${maxHP}`;
}

/**
 * Determines the embed color based on the player party's average health and combat state.
 * @param {string} state - The current combat state ('RUNNING', 'PAUSED', 'ENDED').
 * @param {Array<object>} combatants - The list of combatants in the session.
 * @returns {number} A hex color code.
 */
function getEmbedColor(state, combatants) {
    if (state === 'PAUSED') return 0x4c6a92;
    if (state === 'ENDED') return 0x6c757d;

    const players = combatants.filter(c => c.allegiance === 'PLAYER_SIDE' && c.maxHP > 0);
    if (players.length === 0) return 0x6c757d; // Default to grey if no players

    const totalCurrentHP = players.reduce((sum, p) => sum + p.currentHP, 0);
    const totalMaxHP = players.reduce((sum, p) => sum + p.maxHP, 0);

    if (totalMaxHP === 0) return 0x6c757d;

    const averageHpPercentage = totalCurrentHP / totalMaxHP;

    if (averageHpPercentage < 0.25) return 0xc92a2a; // running-critical
    if (averageHpPercentage < 0.5) return 0xd97706; // running-strained
    return 0x2f9e44; // running-healthy
}

/**
 * Truncates a name to 24 characters with ellipsis suffix if needed.
 * @param {string} name - The name to truncate.
 * @returns {string} Truncated name or original if within limit.
 */
function truncateName(name) {
    if (!name) return 'Unknown';
    if (name.length <= 24) return name;
    return name.substring(0, 21) + '...';
}

/**
 * Builds a spotlight field for the active combatant - state-first display.
 * @param {Object} activeCombatant - The currently active combatant.
 * @returns {Object|null} Embed field object or null if no active combatant.
 */
function buildActiveActorSpotlight(activeCombatant) {
    if (!activeCombatant) return null;

    const side = activeCombatant.allegiance === 'PLAYER_SIDE' ? '🛡️ Heroes' : '⚔️ Hostiles';
    const typeIcon = activeCombatant.type === 'PLAYER' ? '👤' : '👹';
    const hpBar = createHealthBar(activeCombatant.currentHP, activeCombatant.maxHP, 8);
    const hpStatus = activeCombatant.currentHP <= 0 ? ' ⚠️ DOWN' : '';
    const woundDisplay = activeCombatant.wounds > 0 ? `\n🩸 Wounds ${activeCombatant.wounds}` : '';

    // Pain level display
    const painLevel =
        activeCombatant.maxHP > 0 ? calculatePainLevel(activeCombatant.currentHP, activeCombatant.maxHP) : 0;
    const painDisplay = painLevel > 0 ? `\n⚡ Schmerz Stufe ${painLevel} (-${painLevel} on all tests)` : '';

    // Active conditions
    let conditionDisplay = '';
    if (Array.isArray(activeCombatant.conditions) && activeCombatant.conditions.length > 0) {
        const condLines = activeCombatant.conditions.map(cond => {
            const label = CONDITION_LABELS[cond.condition_type] || cond.condition_type;
            return `${getConditionEmoji(cond.condition_type)} ${label} ${cond.level}`;
        });
        conditionDisplay = '\n' + condLines.join(' | ');
    }

    // Active statuses
    let statusDisplay = '';
    if (Array.isArray(activeCombatant.statuses) && activeCombatant.statuses.length > 0) {
        const statusLines = activeCombatant.statuses.map(s => {
            const label = STATUS_LABELS[s.status_type] || s.status_type;
            return `${getStatusEmoji(s.status_type)} ${label}`;
        });
        statusDisplay = '\n' + statusLines.join(' | ');
    }

    let persistentEffectDisplay = '';
    if (Array.isArray(activeCombatant.effects) && activeCombatant.effects.length > 0) {
        const effectLines = activeCombatant.effects
            .filter(effect => effect.effect_type)
            .map(effect => `✨ ${effect.effect_type}${effect.duration_rounds ? ` (${effect.duration_rounds}R)` : ''}`);
        if (effectLines.length > 0) persistentEffectDisplay = '\n' + effectLines.join(' | ');
    }
    const reloadDisplay = activeCombatant.reloadRemaining > 0 ? `\n🏹 Reload ${activeCombatant.reloadRemaining}` : '';
    const defenseDisplay = activeCombatant.defenseCount > 0 ? `\n🛡️ Defenses ${activeCombatant.defenseCount}` : '';

    const value = [
        `**${typeIcon} ${truncateName(activeCombatant.name)}**`,
        `${side} • INI ${activeCombatant.initiativeRoll}`,
        `${hpBar}${hpStatus}${woundDisplay}${painDisplay}${conditionDisplay}${statusDisplay}${persistentEffectDisplay}${reloadDisplay}${defenseDisplay}`,
    ].join('\n');

    return {
        name: '🎯 Active Turn',
        value,
    };
}

/**
 * Builds a compact preview of the next combatants in the turn order.
 * @param {Array} turnOrder - Array of combatant IDs.
 * @param {Array} combatants - Array of combatant objects.
 * @param {number} currentIndex - Current turn index.
 * @returns {Object|null} Embed field object or null if no next combatant.
 */
function buildUpNextPreview(turnOrder, combatants, currentIndex) {
    if (!turnOrder || turnOrder.length === 0 || currentIndex < 0) return null;

    const numCombatants = turnOrder.length;
    let nextIndex = currentIndex;
    let checked = 0;
    const upcomingCombatants = [];

    while (checked < numCombatants && upcomingCombatants.length < 3) {
        nextIndex = (nextIndex + 1) % numCombatants;
        const candidate = combatants.find(c => c.id === turnOrder[nextIndex]);
        if (candidate && candidate.currentHP > 0) {
            upcomingCombatants.push(candidate);
        }
        checked++;
    }

    if (upcomingCombatants.length === 0) return null;

    const previewLines = upcomingCombatants.map((combatant, index) => {
        const side = combatant.allegiance === 'PLAYER_SIDE' ? '🛡️' : '⚔️';
        const hpDisplay = `${combatant.currentHP}/${combatant.maxHP}`;
        const slotLabels = ['Next', 'On Deck', 'Then'];
        return `${slotLabels[index]}: ${side} ${truncateName(combatant.name)} • INI ${combatant.initiativeRoll} • HP ${hpDisplay}`;
    });

    return {
        name: '⏭️ Up Next',
        value: previewLines.join('\n'),
    };
}

/**
 * Normalizes verbose combat log entries for the compact recent-events field.
 * @param {string} line - Raw log line.
 * @returns {string} Compact display line.
 */
function formatRecentEventLine(line) {
    if (!line) return '';

    const trimmed = line.trim();
    const turnBannerMatch = trimmed.match(/^---\s+(.+?)'s Turn\s+---$/);
    if (turnBannerMatch) {
        return `Turn: ${turnBannerMatch[1]}`;
    }

    if (trimmed === '--- Combat Started! ---') return 'Combat started';
    if (trimmed === '--- Combat Resumed ---') return 'Combat resumed';

    const combatEndedMatch = trimmed.match(/^---\s+Combat Ended:\s+(.+?)\s+---$/);
    if (combatEndedMatch) {
        return `Combat ended: ${combatEndedMatch[1]}`;
    }

    return trimmed
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\.\s+\|/g, ' |')
        .replace(/\s+\|\s+/g, ' | ')
        .trim();
}

/**
 * Creates the embed displaying the current state of a running combat.
 * State-first layout: spotlight active actor, up-next preview, compact rosters, condensed events.
 */
function createCombatEmbed(session) {
    if (!session || typeof session !== 'object') {
        log.error('Invalid or missing session object in createCombatEmbed');
        return createEmbed('danger').setTitle('Combat Status Error').setDescription('Invalid session data.');
    }

    const combatants = Array.isArray(session.combatants) ? session.combatants : [];
    const turnOrder = Array.isArray(session.turnOrder) ? session.turnOrder : [];
    const combatLog = Array.isArray(session.combatLog) ? session.combatLog : [];
    const currentTurnIndex =
        typeof session.currentTurnIndex === 'number' && session.currentTurnIndex >= 0 ? session.currentTurnIndex : -1;

    const activeCombatant = turnOrder[currentTurnIndex]
        ? combatants.find(c => c.id === turnOrder[currentTurnIndex])
        : null;

    let title = `Combat Status - ${session.state}`;
    if (typeof session.currentRound === 'number' && session.currentRound > 0) {
        title += ` | Round ${session.currentRound}`;
    }

    const combatEmbed = createEmbed(getEmbedColor(session.state, combatants)).setTitle(title).setTimestamp();

    // Description - minimal now, spotlight field carries the active turn info
    const descriptionLines = [];
    if (session.state === 'PAUSED') {
        descriptionLines.push('⏸️ Combat is paused. Use `/resumecombat` to continue.');
    } else if (session.state === 'ENDED') {
        descriptionLines.push('🏁 This combat has concluded.');
    } else if (session.state === 'RUNNING' && !activeCombatant) {
        descriptionLines.push('Combat is starting...');
    }
    if (descriptionLines.length > 0) {
        combatEmbed.setDescription(descriptionLines.join('\n'));
    }

    // Field 1: Active Actor Spotlight (state-first for RUNNING)
    if (session.state === 'RUNNING' && activeCombatant) {
        const spotlightField = buildActiveActorSpotlight(activeCombatant);
        if (spotlightField) {
            combatEmbed.addFields(spotlightField);
        }

        // Field 2: Up Next Preview
        const upNextField = buildUpNextPreview(turnOrder, combatants, currentTurnIndex);
        if (upNextField) {
            combatEmbed.addFields(upNextField);
        }
    }

    const formatCombatantLine = (c, isCurrent) => {
        const turnIndicator = isCurrent ? '▸ ' : '';
        const name = truncateName(c.name);
        const initiative = c.initiativeRoll;
        const hpPercent = c.maxHP > 0 ? Math.round((c.currentHP / c.maxHP) * 100) : 0;
        const hpDisplay = `${c.currentHP}/${c.maxHP}`;
        const status = c.currentHP <= 0 ? ' | DOWN' : '';

        // Pain level indicator (derived from HP thresholds)
        const painLevel = c.maxHP > 0 ? calculatePainLevel(c.currentHP, c.maxHP) : 0;
        const painIndicator = painLevel > 0 ? ` P${painLevel}` : '';
        const woundIndicator = c.wounds > 0 ? ` W${c.wounds}` : '';

        // Condition/status indicators (if loaded on combatant)
        let effectIndicators = '';
        if (Array.isArray(c.conditions) && c.conditions.length > 0) {
            const condAbbrevs = c.conditions.map(cond => {
                const label = CONDITION_LABELS[cond.condition_type] || cond.condition_type;
                return `${label.substring(0, 3)}${cond.level}`;
            });
            effectIndicators += ' ' + condAbbrevs.join(',');
        }
        if (Array.isArray(c.statuses) && c.statuses.length > 0) {
            const statusAbbrevs = c.statuses.map(s => {
                const label = STATUS_LABELS[s.status_type] || s.status_type;
                return label.substring(0, 3);
            });
            effectIndicators += ' ' + statusAbbrevs.join(',');
        }
        if (Array.isArray(c.effects) && c.effects.some(effect => effect.effect_type)) {
            effectIndicators += ` Fx${c.effects.filter(effect => effect.effect_type).length}`;
        }
        if (c.reloadRemaining > 0) effectIndicators += ` R${c.reloadRemaining}`;
        if (c.defenseCount > 0) effectIndicators += ` D${c.defenseCount}`;

        return `${turnIndicator}${name} [INI ${initiative}] HP ${hpDisplay} (${hpPercent}%)${woundIndicator}${painIndicator}${effectIndicators}${status}`;
    };

    /**
     * Formats a side's combatants with overflow handling (compact version).
     * Shows max 6 combatants: first 5 by initiative + summary line if >6 total.
     */
    const formatSideWithOverflow = (sideCombatants, activeCombatant) => {
        const MAX_VISIBLE = 6;
        const MAX_DETAILED = 5;

        if (sideCombatants.length === 0) return 'None';

        // Sort by initiative (highest first)
        const sorted = [...sideCombatants].sort((a, b) => b.initiativeRoll - a.initiativeRoll);

        if (sorted.length <= MAX_VISIBLE) {
            return sorted.map(c => formatCombatantLine(c, activeCombatant && c.id === activeCombatant.id)).join('\n');
        }

        // Overflow: show first 5 + summary line
        const visible = sorted.slice(0, MAX_DETAILED);
        const overflowCount = sorted.length - MAX_DETAILED;
        const activeCount = sorted.filter(c => c.currentHP > 0).length;
        const downCount = sorted.filter(c => c.currentHP <= 0).length;

        const lines = visible.map(c => formatCombatantLine(c, activeCombatant && c.id === activeCombatant.id));
        lines.push(`+${overflowCount} more | active ${activeCount} | down ${downCount}`);

        return lines.join('\n');
    };

    const playerCombatants = combatants.filter(c => c.allegiance === 'PLAYER_SIDE');
    const hostileCombatants = combatants.filter(c => c.allegiance === 'HOSTILE');

    // Field: Heroes (compact tactical roster)
    if (playerCombatants.length > 0) {
        const playerString = formatSideWithOverflow(playerCombatants, activeCombatant);
        combatEmbed.addFields({ name: '🛡️ Heroes', value: '```\n' + playerString + '\n```', inline: true });
    }

    // Field: Hostiles (compact tactical roster)
    if (hostileCombatants.length > 0) {
        const hostileString = formatSideWithOverflow(hostileCombatants, activeCombatant);
        combatEmbed.addFields({ name: '⚔️ Hostiles', value: '```\n' + hostileString + '\n```', inline: true });
    }

    // Field: Recent Events (compact and normalized)
    let recentLogs = 'No events yet.';
    if (combatLog.length > 0) {
        const MAX_LINE_LENGTH = 80;
        const MAX_LINES = 4;
        const MAX_TOTAL_LENGTH = 400;

        let processedLines = combatLog
            .slice(-MAX_LINES)
            .map(formatRecentEventLine)
            .filter(Boolean)
            .map(line => (line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH - 1) + '…' : line));

        let combined = processedLines.join('\n');
        while (combined.length > MAX_TOTAL_LENGTH && processedLines.length > 1) {
            processedLines = processedLines.slice(1);
            combined = processedLines.join('\n');
        }

        if (combined.length > MAX_TOTAL_LENGTH) {
            combined = combined.substring(0, MAX_TOTAL_LENGTH - 1) + '…';
        }

        recentLogs = combined;
    }
    combatEmbed.addFields({ name: '📜 Recent Events', value: `\`\`\`\n${recentLogs}\n\`\`\``, inline: false });

    combatEmbed.setFooter({ text: `Session ${session.id?.substring(0, 8) || '???'}` });

    return combatEmbed;
}

/**
 * Creates action row for player combat actions.
 */
function createPlayerActionRow(sessionId, actorCombatantId) {
    return createActionMenuRow(sessionId, actorCombatantId);
}

const ACTION_AVAILABILITY_LABELS = {
    attack: 'Attack',
    maneuver: 'Maneuver',
    twoWeapon: 'Two-weapon attack',
    opportunity: 'Opportunity attack',
    fullDefense: 'Full defense',
    reload: 'Reload',
    standUp: 'Stand up',
    escapeGrapple: 'Escape grapple',
    retrieveItem: 'Retrieve item',
    spellOrLiturgy: 'Spell/liturgy',
    genericAction: 'Generic action',
    freeAction: 'Free action',
    resource: 'Resource adjustment',
    endTurn: 'End turn',
};

const ACTION_REASON_LABELS = {
    NOT_ACTIVE_TURN: 'not the active turn',
    INCAPACITATED: 'incapacitated',
    ACTION_ALREADY_SPENT: 'slot already spent',
    ROUND_OPENING_PASSED: 'must be declared first this turn',
    NOT_RELOADING: 'no reload in progress',
    NOT_PRONE: 'not prone',
    NOT_GRAPPLED: 'not grappled',
    NO_DROPPED_ITEM: 'no dropped item',
    NO_RESOURCE_POOL: 'no character resource pool',
    NO_COMPATIBLE_MANEUVER: 'no compatible learned maneuver',
    TWO_WEAPON_UNAVAILABLE: 'requires two equipped one-handed melee weapons',
    NO_OPPORTUNITY: 'no granted opportunity attack',
    FULL_DEFENSE_UNLEARNED: 'Verteidigungshaltung not learned',
    NO_LEARNED_SUPERNATURAL: 'no learned spell or liturgy',
};

function describeUnavailableActions(availability) {
    if (!availability) return null;
    const lines = Object.entries(availability)
        .filter(([, option]) => option && !option.available)
        .map(
            ([key, option]) =>
                `• **${ACTION_AVAILABILITY_LABELS[key] || key}:** ${ACTION_REASON_LABELS[option.reasonCode] || option.reasonCode}`
        );
    return lines.length ? lines.join('\n').slice(0, 1024) : null;
}

function createActionMenuRow(sessionId, actorCombatantId, availability = null) {
    const definitions = [
        ['ATTACK', 'Attack', 'Standard attack against any combatant', 'attack'],
        ['MANEUVER', 'Maneuver', 'Learned compatible combat maneuver', 'maneuver'],
        ['TWO_WEAPON', 'Two-weapon attack', 'Attack with both equipped weapons', 'twoWeapon'],
        ['OPPORTUNITY', 'Opportunity attack', 'Use a granted reaction', 'opportunity'],
        ['FULL_DEFENSE', 'Full defense', 'Spend the action for +4 PA', 'fullDefense'],
        ['RELOAD', 'Reload', 'Continue reloading a ranged weapon', 'reload'],
        ['STAND_UP', 'Stand up', 'Recover from Liegend', 'standUp'],
        ['ESCAPE_GRAPPLE', 'Escape grapple', 'Attempt to break Fixiert/Eingeengt', 'escapeGrapple'],
        ['RETRIEVE', 'Retrieve dropped item', 'Körperbeherrschung check to recover it', 'retrieveItem'],
        ['SPELL', 'Cast spell', 'Choose a learned spell and combatant target', 'spellOrLiturgy'],
        ['LITURGY', 'Perform liturgy', 'Choose a learned liturgy and combatant target', 'spellOrLiturgy'],
        ['GENERIC', 'Generic action', 'Describe a GM-adjudicated action', 'genericAction'],
        ['FREE', 'Free action', 'Describe movement or another free action', 'freeAction'],
        ['RESOURCE', 'Spend resource', 'Spend AsP, KaP, or SchP without using an action', 'resource'],
        ['END_TURN', 'End turn', 'Finish without another action', 'endTurn'],
    ];
    const options = definitions
        .filter(([, , , key]) => !availability || availability[key]?.available)
        .map(([value, label, description]) =>
            new StringSelectMenuOptionBuilder().setValue(value).setLabel(label).setDescription(description)
        );
    if (options.length === 0) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setValue('END_TURN')
                .setLabel('End turn')
                .setDescription('No legal actions remain')
        );
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`cact_${sessionId}_${actorCombatantId}`)
            .setPlaceholder('Choose action…')
            .addOptions(options.slice(0, 25))
    );
}

function createPendingDefenseRow(pending) {
    const available = new Map(
        (pending.defenseOptions || []).filter(option => option.available).map(option => [option.choice, option])
    );
    const buttons = [];
    if (available.has('PARRY')) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`cad_${pending.id}_PARRY`)
                .setLabel(`Parry (${available.get('PARRY').effectiveValue})`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji({ name: '🛡️' })
        );
    }
    if (available.has('DODGE')) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`cad_${pending.id}_DODGE`)
                .setLabel(`Dodge (${available.get('DODGE').effectiveValue})`)
                .setStyle(ButtonStyle.Success)
                .setEmoji({ name: '💨' })
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`cad_${pending.id}_DECLINE`)
            .setLabel('Take Hit')
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ name: '💥' })
    );
    return new ActionRowBuilder().addComponents(buttons);
}

async function handlePendingDefenseInteraction(interaction, actionId, decision) {
    await interaction.deferUpdate();
    try {
        const sessionData = await getOrLoadSession(interaction.client, interaction.channelId);
        if (!sessionData) throw new Error('Active combat data not found.');
        const force = decision === 'DECLINE' && sessionData.dmUserId === interaction.user.id;
        const resolved = await resolvePendingAttack({ discordId: interaction.user.id }, { actionId, decision, force });
        const fresh = await getCombatSession({ discordId: interaction.user.id }, sessionData.id);
        sessionData.state = fresh.session.state;
        sessionData.currentTurnIndex = fresh.session.current_turn_index;
        sessionData.currentRound = fresh.session.current_round;
        sessionData.combatLog = fresh.session.combat_log.slice(-20);
        sessionData.combatants = fresh.combatants.map(combatantToMemory);
        const activeId = sessionData.turnOrder?.[sessionData.currentTurnIndex];
        const remainingPending = await getPendingAttack(
            { discordId: sessionData.dmUserId },
            { sessionId: sessionData.id }
        ).catch(error => {
            if (error.status !== 404) throw error;
            return null;
        });
        if (remainingPending || activeId !== resolved.result.attacker.id) {
            await updateCombatDisplay(interaction.client, interaction.channelId);
        } else {
            await nextTurn(interaction.client, interaction.channelId);
        }
        await interaction.followUp({
            content:
                `${resolved.alreadyResolved ? 'ℹ️ Already resolved:' : '✅'} ${decision.toLowerCase()} — ` +
                `${resolved.result.hitConnected ? `${resolved.result.finalDamage + resolved.result.zoneDamage} damage` : 'no damage'}.`,
            ephemeral: true,
        });
    } catch (error) {
        log.error({ error: error.message, actionId, decision }, 'Pending defense failed');
        await interaction
            .followUp({ content: `❌ ${error.data?.error || error.message}`, ephemeral: true })
            .catch(() => {});
    }
}

/**
 * Creates shared management action row with park/end session buttons.
 * @param {string} sessionId - The combat session ID.
 * @returns {ActionRowBuilder}
 */
function createManagementActionRow(sessionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`park_combat_${sessionId}`)
            .setLabel('Park Session')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji({ name: '🅿️' }),
        new ButtonBuilder()
            .setCustomId(`end_combat_${sessionId}`)
            .setLabel('End Session')
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ name: '🛑' })
    );
}

/**
 * Updates the main combat Discord message.
 */
async function updateCombatDisplay(client, channelId, freshSessionData = null) {
    log.debug({ channelId }, 'Attempting display update');

    let sessionData;
    if (freshSessionData) {
        sessionData = freshSessionData;
    } else {
        if (!client.activeCombats?.has(channelId)) {
            log.error({ channelId }, 'No active combat found in memory');
            return;
        }
        sessionData = client.activeCombats.get(channelId);
    }

    if (!sessionData || !sessionData.id || !sessionData.state || !sessionData.messageId) {
        log.error({ channelId }, 'Session data is invalid/missing fields');
        client.activeCombats?.delete(channelId);
        return;
    }

    const sessionId = sessionData.id;
    log.debug({ sessionId, state: sessionData.state, turnIndex: sessionData.currentTurnIndex }, 'Updating display');

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) {
            log.error({ channelId }, 'Channel invalid');
            client.activeCombats?.delete(channelId);
            return;
        }

        const message = await channel.messages.fetch(sessionData.messageId).catch(() => null);
        if (!message) {
            log.warn({ messageId: sessionData.messageId }, 'Message not found');
            client.activeCombats?.delete(channelId);
            return;
        }

        const combatEmbed = createCombatEmbed(sessionData);
        let actionRows = [];
        let pendingAttack = null;
        let unavailable = null;
        if (sessionData.state === 'RUNNING') {
            pendingAttack = await getPendingAttack({ discordId: sessionData.dmUserId }, { sessionId }).catch(error => {
                if (error.status !== 404) log.warn({ error: error.message, sessionId }, 'Pending attack lookup failed');
                return null;
            });
        }

        if (pendingAttack) {
            combatEmbed.addFields({
                name: '🛡️ Defense decision',
                value:
                    `**${pendingAttack.attackerName}** rolled ${pendingAttack.attack.roll}/${pendingAttack.atValue} against ` +
                    `**${pendingAttack.targetName}**. The defender or DM must choose.`,
            });
            actionRows = [createPendingDefenseRow(pendingAttack), createManagementActionRow(sessionId)];
        } else if (
            sessionData.state === 'RUNNING' &&
            Array.isArray(sessionData.turnOrder) &&
            sessionData.turnOrder.length > sessionData.currentTurnIndex &&
            sessionData.currentTurnIndex >= 0
        ) {
            const activeCombatantId = sessionData.turnOrder[sessionData.currentTurnIndex];
            const activeCombatant = sessionData.combatants?.find(c => c.id === activeCombatantId);

            if (activeCombatant && activeCombatant.currentHP > 0) {
                log.debug({ combatantName: activeCombatant.name, type: activeCombatant.type }, 'Current turn');
                const availability = await getCombatActionMenu(
                    { discordId: sessionData.dmUserId },
                    { sessionId, combatantId: activeCombatantId }
                ).catch(error => {
                    log.warn({ error: error.message, sessionId }, 'Action availability lookup failed');
                    return null;
                });
                unavailable = describeUnavailableActions(availability?.options);
                if (unavailable) {
                    combatEmbed.addFields({ name: 'Unavailable right now', value: unavailable, inline: false });
                }
                actionRows = [
                    createActionMenuRow(sessionId, activeCombatantId, availability?.options),
                    createManagementActionRow(sessionId),
                ];
            }
        } else if (sessionData.state === 'ENDED') {
            actionRows = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`show_full_log_${sessionId}`)
                        .setLabel('Show Full Log')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji({ name: '📜' })
                ),
            ];
        }

        if (messageUsesComponentsV2(message)) {
            await editComponentMessage(
                message,
                buildCombatComponentPayload(sessionData, pendingAttack, {
                    actionRows,
                    unavailable,
                    recentLogs: sessionData.combatLog,
                })
            );
        } else {
            await message.edit({
                content: ' ',
                embeds: [combatEmbed],
                components: actionRows,
            });
        }
        log.debug({ sessionId }, 'Message edit successful');
    } catch (error) {
        log.error({ error: error.message, channelId }, 'Failed to update display');
        if (error.code === 10008) {
            client.activeCombats?.delete(channelId);
        }
    }
}

module.exports = {
    getOrLoadSession,
    handleCombatActionAttack,
    handleCombatActionSkill,
    handleCombatActionMenuSelect,
    handleCombatAbilitySelect,
    handleCombatAbilityTarget,
    handleTwoWeaponTargetSelect,
    handleOpportunityTargetSelect,
    handleRetrieveWeaponSelect,
    handleRetrieveOpponentSelect,
    handleCombatActionModal,
    handleCombatEndTurnInteraction,
    resolveCombatAction,
    handleCombatTargetSelectAttack,
    handleCombatSkillManeuverSelect,
    handleShowFullLogInteraction,
    handleParkCombatInteraction,
    handleEndCombatInteraction,
    handleResumeSessionSelect,
    addLogEntry,
    getEffectiveCombatStats,
    nextTurn,
    createCombatEmbed,
    createPlayerActionRow,
    createActionMenuRow,
    createPendingDefenseRow,
    handlePendingDefenseInteraction,
    createManagementActionRow,
    updateCombatDisplay,
};
