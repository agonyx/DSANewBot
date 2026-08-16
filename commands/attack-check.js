const { SlashCommandBuilder } = require('discord.js');
const { and, eq, inArray } = require('drizzle-orm');
const { db } = require('../db');
const { players, playerActionModifications, actionModifications } = require('../db/schema');
const { performAttackCheck } = require('../services/attackChecks');
const { createEmbed } = require('../utils/embedUtils');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const { createLogger } = require('../utils/logger');

const log = createLogger('attack-check');
const data = new SlashCommandBuilder()
    .setName('attack-check')
    .setDescription('Roll a target-free attack check without changing any character or combat state')
    .addStringOption(option =>
        option.setName('maneuver').setDescription('Optional learned attack maneuver').setAutocomplete(true)
    )
    .addIntegerOption(option =>
        option.setName('modifier').setDescription('Situational modifier').setMinValue(-20).setMaxValue(20)
    );
addVisibilityOption(data);

module.exports = {
    data,
    async autocomplete(interaction) {
        try {
            const [player] = await db
                .select({ id: players.id })
                .from(players)
                .where(and(eq(players.discord_id, interaction.user.id), eq(players.selected, 'YES')))
                .limit(1);
            if (!player) return interaction.respond([]);
            const learned = await db
                .select({ id: actionModifications.id, name: actionModifications.name })
                .from(playerActionModifications)
                .innerJoin(
                    actionModifications,
                    eq(playerActionModifications.action_modification_id, actionModifications.id)
                )
                .where(
                    and(
                        eq(playerActionModifications.player_id, player.id),
                        inArray(actionModifications.action_type, ['MELEE', 'RANGED'])
                    )
                );
            const focused = String(interaction.options.getFocused() || '').toLowerCase();
            return interaction.respond(
                learned
                    .filter(row => row.name.toLowerCase().includes(focused))
                    .slice(0, 25)
                    .map(row => ({ name: row.name, value: row.id }))
            );
        } catch (error) {
            log.error({ error }, 'Attack-check autocomplete failed');
            return interaction.respond([]);
        }
    },
    async execute(interaction) {
        await deferWithVisibility(interaction);
        try {
            const result = await performAttackCheck(
                { discordId: interaction.user.id },
                {
                    maneuverId: interaction.options.getString('maneuver'),
                    modifier: interaction.options.getInteger('modifier') ?? 0,
                }
            );
            const outcome = result.attack.outcome.replaceAll('_', ' ').toLowerCase();
            const embed = createEmbed(
                result.attack.outcome.includes('SUCCESS') || result.attack.outcome === 'NORMAL_HIT'
                    ? 'success'
                    : 'danger'
            )
                .setTitle('Target-free attack check')
                .setDescription(
                    `**${result.character.name}**${result.weapon ? ` with **${result.weapon.name}**` : ''}${
                        result.maneuver ? ` using **${result.maneuver.name}**` : ''
                    }\n\nRoll: **${result.attack.roll} / ${result.effectiveValue}** — ${outcome}.`
                )
                .setFooter({ text: 'Check only · no target, defense, damage, or database mutation' });
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Attack check failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
