const { SlashCommandBuilder } = require('discord.js');
const { applyEffect, listEffects, removeEffect } = require('../services/combatEffects');
const { updateCombatDisplay } = require('../handlers/combatHandler');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');

const log = createLogger('effect');

function findTarget(interaction, userId) {
    const session = interaction.client.activeCombats?.get(interaction.channelId);
    if (!session || !['RUNNING', 'PAUSED'].includes(session.state))
        throw new Error('No active combat in this channel.');
    const combatant = session.combatants.find(entry => entry.discordUserId === userId);
    if (!combatant) throw new Error('That user is not a combatant in this encounter.');
    return combatant;
}

function renderEffects(name, effects) {
    const lines = effects.map(effect => {
        const modifiers = [
            ['AT', effect.at_modifier],
            ['PA', effect.pa_modifier],
            ['TP', effect.damage_modifier],
            ['RS', effect.armor_modifier],
            ['checks', effect.check_modifier],
        ]
            .filter(([, value]) => value)
            .map(([label, value]) => `${label} ${value > 0 ? '+' : ''}${value}`)
            .join(', ');
        const duration = effect.duration_rounds == null ? 'permanent' : `${effect.duration_rounds} round(s)`;
        return `**${effect.effect_type}** — ${modifiers || 'state only'}; ${duration}`;
    });
    return createEmbed(effects.length ? 'combat' : 'success')
        .setTitle(`✨ Effects — ${name}`)
        .setDescription(lines.join('\n') || 'No persistent effects.');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('effect')
        .setDescription('Manage persistent combat buffs, debuffs, and stances (DM)')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add or replace an effect')
                .addUserOption(option => option.setName('target').setDescription('Target combatant').setRequired(true))
                .addStringOption(option => option.setName('name').setDescription('Effect name').setRequired(true))
                .addIntegerOption(option =>
                    option.setName('at').setDescription('AT modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('pa').setDescription('PA modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('damage').setDescription('Damage modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('armor').setDescription('Armor modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('checks').setDescription('General check modifier').setMinValue(-20).setMaxValue(20)
                )
                .addIntegerOption(option =>
                    option.setName('duration').setDescription('Rounds; omit for permanent').setMinValue(1)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove an effect')
                .addUserOption(option => option.setName('target').setDescription('Target combatant').setRequired(true))
                .addStringOption(option => option.setName('name').setDescription('Effect name').setRequired(true))
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List effects')
                .addUserOption(option => option.setName('target').setDescription('Target (defaults to yourself)'))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('target') || interaction.user;
        try {
            const combatant = findTarget(interaction, targetUser.id);
            const ctx = { discordId: interaction.user.id };
            if (subcommand === 'add') {
                await applyEffect(ctx, {
                    combatantId: combatant.id,
                    effectType: interaction.options.getString('name'),
                    atModifier: interaction.options.getInteger('at') || 0,
                    paModifier: interaction.options.getInteger('pa') || 0,
                    damageModifier: interaction.options.getInteger('damage') || 0,
                    armorModifier: interaction.options.getInteger('armor') || 0,
                    checkModifier: interaction.options.getInteger('checks') || 0,
                    durationRounds: interaction.options.getInteger('duration'),
                });
            } else if (subcommand === 'remove') {
                await removeEffect(ctx, {
                    combatantId: combatant.id,
                    effectType: interaction.options.getString('name'),
                });
            }
            const effects = await listEffects(ctx, combatant.id);
            combatant.effects = effects;
            updateCombatDisplay(interaction.client, interaction.channelId).catch(() => {});
            return interaction.editReply({ embeds: [renderEffects(combatant.name, effects)] });
        } catch (error) {
            log.error({ error }, 'Effect command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
