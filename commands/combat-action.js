const { SlashCommandBuilder } = require('discord.js');
const {
    escapeGrapple,
    reloadAction,
    resolveTwoWeaponAttackAction,
    standUp,
    takeFullDefense,
} = require('../services/combat');
const { nextTurn, resolveCombatAction, updateCombatDisplay } = require('../handlers/combatTurnHandler');
const { createLogger } = require('../utils/logger');

const log = createLogger('combat-action');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combat-action')
        .setDescription('Use a special action; the combat panel exposes these without slash commands')
        .addSubcommand(sub =>
            sub.setName('full-defense').setDescription('Spend the turn for +4 PA until your next turn')
        )
        .addSubcommand(sub => sub.setName('reload').setDescription('Spend the turn on one ranged reload action'))
        .addSubcommand(sub => sub.setName('escape-grapple').setDescription('Attempt to escape Fixiert/Eingeengt'))
        .addSubcommand(sub => sub.setName('stand-up').setDescription('Spend the turn to stand up from Liegend'))
        .addSubcommand(sub =>
            sub
                .setName('two-weapon')
                .setDescription('Attack once with each equipped one-handed melee weapon')
                .addStringOption(option =>
                    option
                        .setName('target')
                        .setDescription('First combatant target')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption(option =>
                    option.setName('second_target').setDescription('Optional second combatant').setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('opportunity')
                .setDescription('Use a granted unopposed Passierschlag at AT -4')
                .addStringOption(option =>
                    option.setName('target').setDescription('Combatant target').setRequired(true).setAutocomplete(true)
                )
        ),

    async autocomplete(interaction) {
        const session = interaction.client.activeCombats?.get(interaction.channelId);
        const focused = String(interaction.options.getFocused() || '').toLowerCase();
        return interaction.respond(
            (session?.combatants || [])
                .filter(combatant => combatant.currentHP > 0 && combatant.name.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(combatant => ({ name: combatant.name.slice(0, 100), value: combatant.id }))
        );
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const session = interaction.client.activeCombats?.get(interaction.channelId);
        if (!session || session.state !== 'RUNNING')
            return interaction.editReply('❌ No running combat in this channel.');
        const actor = session.combatants.find(combatant => combatant.discordUserId === interaction.user.id);
        if (!actor) return interaction.editReply('❌ You are not a combatant in this encounter.');

        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'opportunity') {
                const target = session.combatants.find(
                    combatant => combatant.id === interaction.options.getString('target')
                );
                if (!target) return interaction.editReply('❌ The target combatant is not in this encounter.');
                await resolveCombatAction(
                    interaction.client,
                    interaction.channelId,
                    session.id,
                    actor.id,
                    target.id,
                    null,
                    {
                        callerDiscordId: interaction.user.id,
                        attackKind: 'opportunity',
                        advanceTurn: false,
                    }
                );
                return interaction.editReply(`✅ Passierschlag against **${target.name}** resolved.`);
            }

            if (subcommand === 'two-weapon') {
                const firstId = interaction.options.getString('target');
                const secondId = interaction.options.getString('second_target') ?? firstId;
                const firstTarget = session.combatants.find(combatant => combatant.id === firstId);
                const secondTarget = session.combatants.find(combatant => combatant.id === secondId);
                if (!firstTarget || !secondTarget) {
                    return interaction.editReply('❌ Each target must be a combatant in this encounter.');
                }
                const result = await resolveTwoWeaponAttackAction(ctx, {
                    sessionId: session.id,
                    attackerId: actor.id,
                    targetIds: [firstTarget.id, secondTarget.id],
                });
                if (result.status === 'PENDING') {
                    await updateCombatDisplay(interaction.client, interaction.channelId);
                    return interaction.editReply(
                        result.attacks.length
                            ? '🛡️ Main-hand attack resolved; waiting for the second defense decision.'
                            : '🛡️ Main-hand attack hit; waiting for the defender to choose.'
                    );
                }
                await nextTurn(interaction.client, interaction.channelId);
                const summary = result.attacks
                    .map(
                        (attack, index) =>
                            `${index === 0 ? 'Main hand' : 'Off hand'} vs **${attack.target.name}**: ` +
                            `${attack.hitConnected ? `${attack.finalDamage + attack.zoneDamage} damage` : 'missed'}`
                    )
                    .join('\n');
                const skipped = result.secondAttackSkipped ? `\nSecond attack skipped: ${result.skipReason}.` : '';
                return interaction.editReply(`✅ Two-weapon action resolved.\n${summary}${skipped}`);
            }

            if (subcommand === 'full-defense') {
                await takeFullDefense(ctx, { sessionId: session.id, combatantId: actor.id });
            } else if (subcommand === 'reload') {
                const updated = await reloadAction(ctx, { sessionId: session.id, combatantId: actor.id });
                actor.reloadRemaining = updated.reload_remaining;
            } else if (subcommand === 'escape-grapple') {
                await escapeGrapple(ctx, { sessionId: session.id, combatantId: actor.id });
            } else if (subcommand === 'stand-up') {
                await standUp(ctx, { sessionId: session.id, combatantId: actor.id });
            }
            await nextTurn(interaction.client, interaction.channelId);
            return interaction.editReply(`✅ ${subcommand} resolved.`);
        } catch (error) {
            log.error({ error, subcommand }, 'Combat action failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
