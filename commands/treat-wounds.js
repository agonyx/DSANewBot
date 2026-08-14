const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getCharacterSheet } = require('../services/characters');
const { treatWounds } = require('../services/wounds');
const { createLogger } = require('../utils/logger');

const log = createLogger('treat-wounds');

const TREATMENTS = [
    ['healing', 'Heilung fördern', 'Prepare bonus LeP for the next regeneration phase'],
    ['pain', 'Schmerzen nehmen', 'Suppress pain until a later regeneration phase'],
    ['stabilize', 'Stabilisieren', 'Stabilize a character at 0 or fewer LeP'],
    ['bleeding', 'Blutung behandeln', 'Reduce the remaining duration of Blutend'],
];

function addTreatmentSubcommand(builder, [name, label, description]) {
    return builder
        .setName(name)
        .setDescription(description)
        .addUserOption(option => option.setName('target').setDescription(`Target for ${label}`))
        .addIntegerOption(option =>
            option.setName('modifier').setDescription('Additional probe modifier').setMinValue(-20).setMaxValue(20)
        );
}

function buildResultEmbed(result, user) {
    const outcome = result.criticalSuccess
        ? 'Critical success'
        : result.fumble
          ? 'Fumble'
          : result.success
            ? `Success (QS ${result.qualityLevel})`
            : 'Failure';
    const effects = [];
    if (result.pendingHealingBonus > 0) {
        effects.push(`Next regeneration bonus: **+${result.pendingHealingBonus} LeP**`);
    }
    if (result.painSuppression > 0) {
        effects.push(
            `Pain suppressed: **${result.painSuppression} level(s)** for ${result.painSuppressionPhases} regeneration phase(s)`
        );
    }
    if (result.lifePointsAfter !== result.lifePointsBefore) {
        effects.push(`LeP: **${result.lifePointsBefore} → ${result.lifePointsAfter}**`);
    }
    if (result.woundsAfter !== result.woundsBefore) {
        effects.push(`Wounds: **${result.woundsBefore} → ${result.woundsAfter}**`);
    }
    if (result.bleedingRoundsBefore !== null) {
        effects.push(`Bleeding: **${result.bleedingRoundsBefore} → ${result.bleedingRoundsAfter} rounds**`);
    }
    if (effects.length === 0) effects.push('No lasting treatment effect.');

    return new EmbedBuilder()
        .setColor(result.success ? 0x57f287 : 0xed4245)
        .setTitle(`🩹 Heilkunde Wunden — ${result.targetName}`)
        .setDescription(`${result.healerName}: **${outcome}**`)
        .addFields(
            {
                name: 'Probe',
                value: `${result.rolls.join(' / ')}${result.modifier ? ` (${result.modifier >= 0 ? '+' : ''}${result.modifier})` : ''}`,
            },
            { name: 'Effect', value: effects.join('\n') }
        )
        .setFooter({ text: `Treatment by ${user.username}`, iconURL: user.avatarURL() })
        .setTimestamp();
}

module.exports = {
    data: TREATMENTS.reduce(
        (builder, treatment) => builder.addSubcommand(sub => addTreatmentSubcommand(sub, treatment)),
        new SlashCommandBuilder().setName('treat-wounds').setDescription('Apply Heilkunde Wunden first aid')
    ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const treatmentType = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('target') || interaction.user;
        const modifier = interaction.options.getInteger('modifier') || 0;
        const session = interaction.client.activeCombats?.get(interaction.channelId);
        const combatant = session?.combatants?.find(entry => entry.discordUserId === targetUser.id) || null;

        try {
            const { player: targetPlayer } = await getCharacterSheet({ discordId: targetUser.id });
            const ctx = {
                discordId: interaction.user.id,
                ...(session?.dmUserId === interaction.user.id ? { role: 'DM' } : {}),
            };
            const result = await treatWounds(ctx, {
                treatmentType,
                targetPlayerId: targetPlayer.id,
                combatantId: combatant?.id,
                modifier,
            });

            if (combatant) {
                combatant.currentHP = result.lifePointsAfter;
                combatant.wounds = result.woundsAfter;
                if (result.bleedingRoundsBefore !== null && result.bleedingRoundsAfter === 0) {
                    combatant.statuses = (combatant.statuses || []).filter(status => status.status_type !== 'blutend');
                }
            }

            return interaction.editReply({ embeds: [buildResultEmbed(result, interaction.user)] });
        } catch (error) {
            log.error({ error }, 'Wound treatment failed');
            return interaction.editReply({ content: `❌ ${error.data?.error || error.message}` });
        }
    },
};
