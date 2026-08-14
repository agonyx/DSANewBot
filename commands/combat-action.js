const { SlashCommandBuilder } = require('discord.js');
const {
    escapeGrapple,
    reloadAction,
    resolveTwoWeaponAttackAction,
    standUp,
    takeFullDefense,
} = require('../services/combat');
const { nextTurn, resolveCombatAction } = require('../handlers/combatTurnHandler');
const { createLogger } = require('../utils/logger');

const log = createLogger('combat-action');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('combat-action')
        .setDescription('Use a defensive, reload, grapple, or opportunity combat action')
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
                .addUserOption(option => option.setName('target').setDescription('First target').setRequired(true))
                .addUserOption(option =>
                    option.setName('second_target').setDescription('Optional target for the off-hand attack')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('opportunity')
                .setDescription('Use a granted unopposed Passierschlag at AT -4')
                .addUserOption(option =>
                    option.setName('target').setDescription('Opportunity target').setRequired(true)
                )
        ),

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
                const targetUser = interaction.options.getUser('target');
                const target = session.combatants.find(combatant => combatant.discordUserId === targetUser.id);
                if (!target) return interaction.editReply('❌ The target is not a player combatant in this encounter.');
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
                const firstUser = interaction.options.getUser('target');
                const secondUser = interaction.options.getUser('second_target') ?? firstUser;
                const firstTarget = session.combatants.find(combatant => combatant.discordUserId === firstUser.id);
                const secondTarget = session.combatants.find(combatant => combatant.discordUserId === secondUser.id);
                if (!firstTarget || !secondTarget) {
                    return interaction.editReply('❌ Each target must be a player combatant in this encounter.');
                }
                const result = await resolveTwoWeaponAttackAction(ctx, {
                    sessionId: session.id,
                    attackerId: actor.id,
                    targetIds: [firstTarget.id, secondTarget.id],
                });
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
