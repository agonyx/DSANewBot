const { SlashCommandBuilder } = require('discord.js');
const { beginAttackAction } = require('../services/combat');
const { getOrLoadSession, nextTurn } = require('../handlers/combatTurnHandler');
const combatHandler = require('../handlers/combatHandler');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const { createLogger } = require('../utils/logger');

const log = createLogger('attack-resolve');
const data = new SlashCommandBuilder()
    .setName('attack-resolve')
    .setDescription('Resolve a tracked combat attack that can change HP, wounds, and equipment')
    .addStringOption(option =>
        option.setName('target').setDescription('Target combatant').setRequired(true).setAutocomplete(true)
    )
    .addStringOption(option =>
        option.setName('maneuver').setDescription('Optional learned maneuver').setAutocomplete(true)
    )
    .addBooleanOption(option =>
        option.setName('confirm').setDescription('Confirm this mutating combat action').setRequired(true)
    );
addVisibilityOption(data);

module.exports = {
    data,
    async autocomplete(interaction) {
        const session = interaction.client.activeCombats?.get(interaction.channelId);
        const focused = interaction.options.getFocused(true);
        if (focused.name === 'target') {
            const actor = session?.combatants?.find(combatant =>
                combatant.type === 'PLAYER'
                    ? combatant.discordUserId === interaction.user.id
                    : session.dmUserId === interaction.user.id &&
                      combatant.id === session.turnOrder?.[session.currentTurnIndex]
            );
            return interaction.respond(
                (session?.combatants || [])
                    .filter(
                        combatant =>
                            combatant.id !== actor?.id &&
                            combatant.currentHP > 0 &&
                            combatant.name.toLowerCase().includes(String(focused.value).toLowerCase())
                    )
                    .slice(0, 25)
                    .map(combatant => ({ name: combatant.name.slice(0, 100), value: combatant.id }))
            );
        }
        return require('./attack-check').autocomplete(interaction);
    },
    async execute(interaction) {
        await deferWithVisibility(interaction);
        try {
            if (!interaction.options.getBoolean('confirm', true))
                return interaction.editReply('❌ Attack resolution was not confirmed.');
            const session = await getOrLoadSession(interaction.client, interaction.channelId);
            if (!session || session.state !== 'RUNNING') throw new Error('No running combat in this channel.');
            const actorId = session.turnOrder?.[session.currentTurnIndex];
            const actor = session.combatants.find(combatant => combatant.id === actorId);
            if (!actor) throw new Error('Active combatant not found.');
            const result = await beginAttackAction(
                { discordId: interaction.user.id },
                {
                    sessionId: session.id,
                    attackerId: actor.id,
                    targetId: interaction.options.getString('target', true),
                    maneuverId: interaction.options.getString('maneuver'),
                }
            );
            if (result.status === 'PENDING') {
                await combatHandler.updateCombatDisplay(interaction.client, interaction.channelId, session);
                return interaction.editReply(
                    `🛡️ Attack rolled ${result.pending.attack.roll}/${result.pending.atValue}; waiting for **${result.pending.targetName}** to choose a defense.`
                );
            }
            await nextTurn(interaction.client, interaction.channelId);
            return interaction.editReply(
                `✅ Attack resolved: ${result.result.hitConnected ? `${result.result.finalDamage + result.result.zoneDamage} damage` : 'no damage'}.`
            );
        } catch (error) {
            log.error({ error }, 'Attack resolution failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
