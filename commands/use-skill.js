const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../db');
const { eq, and } = require('drizzle-orm');
const { players, playerActionModifications, actionModifications } = require('../db/schema');
const { resolveCombatAction } = require('../handlers/combatHandler');
const { createLogger } = require('../utils/logger');
const log = createLogger('use-skill');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('use-skill')
        .setDescription('Uses a special combat skill against a target.')
        .addUserOption(option => option.setName('target').setDescription('The target for your skill').setRequired(true))
        .addStringOption(option =>
            option
                .setName('maneuver')
                .setDescription('The combat maneuver to use')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('hit_zone')
                .setDescription('Optional called-shot zone')
                .addChoices(
                    { name: 'Head', value: 'head' },
                    { name: 'Torso', value: 'torso' },
                    { name: 'Left arm', value: 'left_arm' },
                    { name: 'Right arm', value: 'right_arm' },
                    { name: 'Left leg', value: 'left_leg' },
                    { name: 'Right leg', value: 'right_leg' }
                )
        )
        .addIntegerOption(option =>
            option.setName('distance').setDescription('Target distance for ranged attacks').setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('cover_penalty').setDescription('Cover penalty (0-4)').setMinValue(0).setMaxValue(4)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const { client, user } = interaction;

        try {
            const [player] = await db
                .select({ id: players.id })
                .from(players)
                .where(and(eq(players.discord_id, user.id), eq(players.selected, 'YES')))
                .limit(1);

            if (!player) return await interaction.respond([]);

            const skillRows = await db
                .select({
                    skill_id: actionModifications.id,
                    skill_name: actionModifications.name,
                    skill_action_type: actionModifications.action_type,
                })
                .from(playerActionModifications)
                .innerJoin(
                    actionModifications,
                    eq(playerActionModifications.action_modification_id, actionModifications.id)
                )
                .where(eq(playerActionModifications.player_id, player.id));

            const combatSkills = skillRows
                .filter(s => s.skill_id != null && ['MELEE', 'RANGED'].includes(s.skill_action_type))
                .map(s => ({ id: s.skill_id, name: s.skill_name, action_type: s.skill_action_type }));

            const choices = combatSkills.map(skill => ({ name: skill.name, value: skill.id }));
            const filtered = choices.filter(choice => choice.name.toLowerCase().startsWith(focusedValue.toLowerCase()));

            await interaction.respond(filtered);
        } catch (error) {
            log.error({ error }, 'Error during maneuver autocomplete');
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { client, channelId, user } = interaction;
        const targetUser = interaction.options.getUser('target');
        const maneuverId = interaction.options.getString('maneuver');
        const hitZone = interaction.options.getString('hit_zone');
        const distance = interaction.options.getInteger('distance');
        const coverPenalty = interaction.options.getInteger('cover_penalty') || 0;

        const sessionData = client.activeCombats.get(channelId);
        if (!sessionData || sessionData.state !== 'RUNNING') {
            return interaction.editReply('❌ There is no active combat in this channel.');
        }

        const attackerCombatant = sessionData.combatants.find(c => c.discordUserId === user.id);
        if (!attackerCombatant) {
            return interaction.editReply('❌ You are not in this combat.');
        }

        const activeCombatantId = sessionData.turnOrder[sessionData.currentTurnIndex];
        if (attackerCombatant.id !== activeCombatantId) {
            return interaction.editReply("❌ It's not your turn!");
        }

        const targetCombatant = sessionData.combatants.find(c => c.discordUserId === targetUser.id);
        if (!targetCombatant) {
            return interaction.editReply('❌ The specified target is not in this combat.');
        }

        const [playerSkill] = await db
            .select({ id: playerActionModifications.id })
            .from(playerActionModifications)
            .where(
                and(
                    eq(playerActionModifications.player_id, attackerCombatant.player_id),
                    eq(playerActionModifications.action_modification_id, maneuverId)
                )
            )
            .limit(1);

        if (!playerSkill) {
            return interaction.editReply('❌ You do not have access to this skill or it does not exist.');
        }

        await resolveCombatAction(
            client,
            channelId,
            sessionData.id,
            attackerCombatant.id,
            targetCombatant.id,
            maneuverId,
            {
                callerDiscordId: user.id,
                hitZone,
                distance,
                coverPenalty,
            }
        );

        await interaction.editReply(`Your skill use against ${targetUser.username} has been resolved.`);
    },
};
