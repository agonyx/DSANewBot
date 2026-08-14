const { SlashCommandBuilder } = require('discord.js');
const { applyCondition, listConditions, removeCondition, resistCondition } = require('../services/combatEffects');
const { createLogger } = require('../utils/logger');
const {
    CONDITION_TYPES,
    CONDITION_LABELS,
    getConditionEmoji,
    calculateTotalPenalty,
} = require('../utils/conditionUtils');

const { updateCombatDisplay } = require('../handlers/combatHandler');
const { createEmbed, makeFooter } = require('../utils/embedUtils');
const log = createLogger('condition');

/**
 * Storable condition types — excludes SCHMERZ (derived from LP).
 * Used to build slash command choices.
 */
const STORABLE_CONDITIONS = Object.entries(CONDITION_TYPES)
    .filter(([key]) => key !== 'SCHMERZ')
    .map(([, value]) => ({
        name: CONDITION_LABELS[value],
        value,
    }));

/**
 * Finds the combatant for a given Discord user in the active combat session.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} discordUserId
 * @returns {{ combatant: object|null, error: string|null }}
 */
function findCombatant(interaction, discordUserId) {
    const sessionData = interaction.client.activeCombats.get(interaction.channelId);
    if (!sessionData || (sessionData.state !== 'RUNNING' && sessionData.state !== 'PAUSED')) {
        return { combatant: null, error: '❌ No active combat in this channel.' };
    }

    const combatant = sessionData.combatants.find(c => c.discordUserId === discordUserId);
    if (!combatant) {
        return { combatant: null, error: '❌ That user is not in this combat.' };
    }

    return { combatant, error: null };
}

/**
 * Builds a summary embed showing all active conditions for a combatant.
 * @param {string} characterName
 * @param {Array<{ condition_type: string, level: number, source: string|null }>} conditions
 * @param {import('discord.js').User} user - The Discord user for the footer
 * @returns {EmbedBuilder}
 */
function buildConditionEmbed(characterName, conditions, user) {
    const embed = createEmbed(conditions.length > 0 ? 'danger' : 'success')
        .setTitle(`${conditions.length > 0 ? '⚠️' : '✅'} Zustände — ${characterName}`)
        .setTimestamp()
        .setFooter(makeFooter(user, 'Aktualisiert von'));

    if (conditions.length === 0) {
        embed.setDescription('Keine aktiven Zustände.');
        return embed;
    }

    const lines = conditions.map(c => {
        const emoji = getConditionEmoji(c.condition_type);
        const label = CONDITION_LABELS[c.condition_type] || c.condition_type;
        const levelBar = '●'.repeat(c.level) + '○'.repeat(4 - c.level);
        const source = c.source ? ` *(${c.source})*` : '';
        return `${emoji} **${label}** ${levelBar} (Stufe ${c.level})${source}`;
    });

    embed.setDescription(lines.join('\n'));

    const penalty = calculateTotalPenalty(conditions);
    embed.addFields({ name: 'Gesamtabzug', value: `**-${penalty}** (max -5)`, inline: true });

    return embed;
}

/**
 * Fetches all conditions for a combatant from the database.
 * @param {string} combatantId
 * @returns {Promise<Array>}
 */
async function fetchConditions(ctx, combatantId) {
    return listConditions(ctx, combatantId);
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleAdd(interaction) {
    const targetUser = interaction.options.getUser('target');
    const conditionType = interaction.options.getString('condition_type');
    const level = interaction.options.getInteger('level');
    const source = interaction.options.getString('source') || null;
    const durationType = interaction.options.getString('duration_type') || null;
    const durationRemaining = interaction.options.getInteger('duration_remaining') || null;

    const { combatant, error: findError } = findCombatant(interaction, targetUser.id);
    if (findError) return interaction.editReply({ content: findError });

    const ctx = { discordId: interaction.user.id };
    await applyCondition(ctx, {
        combatantId: combatant.id,
        conditionType,
        level,
        source,
        durationType,
        durationRemaining,
    });

    const label = CONDITION_LABELS[conditionType] || conditionType;
    log.info({ combatantId: combatant.id, conditionType, level }, `Condition added: ${label} ${level}`);

    const conditions = await fetchConditions(ctx, combatant.id);

    // Sync in-memory combatant so combat display reflects the change
    combatant.conditions = conditions;
    updateCombatDisplay(interaction.client, interaction.channelId).catch(() => {});

    const characterName = combatant.name || targetUser.username;
    const embed = buildConditionEmbed(characterName, conditions, interaction.user);
    embed.setTitle(`${getConditionEmoji(conditionType)} ${label} Stufe ${level} — ${characterName}`);

    return interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction) {
    const targetUser = interaction.options.getUser('target');
    const conditionType = interaction.options.getString('condition_type');

    const { combatant, error: findError } = findCombatant(interaction, targetUser.id);
    if (findError) return interaction.editReply({ content: findError });

    const label = CONDITION_LABELS[conditionType] || conditionType;
    const ctx = { discordId: interaction.user.id };
    await removeCondition(ctx, { combatantId: combatant.id, conditionType });

    log.info({ combatantId: combatant.id, conditionType }, `Condition removed: ${label}`);

    const conditions = await fetchConditions(ctx, combatant.id);

    // Sync in-memory combatant so combat display reflects the change
    combatant.conditions = conditions;
    updateCombatDisplay(interaction.client, interaction.channelId).catch(() => {});

    const characterName = combatant.name || targetUser.username;
    const embed = buildConditionEmbed(characterName, conditions, interaction.user);

    return interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction) {
    const targetUser = interaction.options.getUser('target') || interaction.user;

    const { combatant, error: findError } = findCombatant(interaction, targetUser.id);
    if (findError) return interaction.editReply({ content: findError });

    const conditions = await fetchConditions({ discordId: interaction.user.id }, combatant.id);
    const characterName = combatant.name || targetUser.username;
    const embed = buildConditionEmbed(characterName, conditions, interaction.user);

    return interaction.editReply({ embeds: [embed] });
}

async function handleResist(interaction) {
    const targetUser = interaction.options.getUser('target') || interaction.user;
    const modifier = interaction.options.getInteger('modifier') || 0;
    const { combatant, error: findError } = findCombatant(interaction, targetUser.id);
    if (findError) return interaction.editReply({ content: findError });
    const result = await resistCondition(
        { discordId: interaction.user.id },
        { combatantId: combatant.id, conditionType: 'furcht', modifier }
    );
    combatant.conditions = await fetchConditions({ discordId: interaction.user.id }, combatant.id);
    updateCombatDisplay(interaction.client, interaction.channelId).catch(() => {});
    return interaction.editReply(
        `${result.success ? '✅' : '❌'} Willenskraft ${result.rolls.join('/')} — Furcht ${result.levelBefore} → ${result.levelAfter}`
    );
}

// ---------------------------------------------------------------------------
// Command export
// ---------------------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('condition')
        .setDescription('Manage DSA 5e conditions (Zustände) on combatants')
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('Add or update a condition on a combatant')
                .addUserOption(opt => opt.setName('target').setDescription('Target combatant').setRequired(true))
                .addStringOption(opt =>
                    opt
                        .setName('condition_type')
                        .setDescription('The condition to apply')
                        .setRequired(true)
                        .addChoices(...STORABLE_CONDITIONS)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('level')
                        .setDescription('Condition level (Stufe I-IV)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(4)
                )
                .addStringOption(opt =>
                    opt.setName('source').setDescription('Source of the condition (e.g. spell name, poison)')
                )
                .addStringOption(opt =>
                    opt
                        .setName('duration_type')
                        .setDescription('How the duration is tracked')
                        .addChoices(
                            { name: 'Kampfrunden', value: 'rounds' },
                            { name: 'Minuten', value: 'minutes' },
                            { name: 'Stunden', value: 'hours' },
                            { name: 'Bis Rast', value: 'rest' },
                            { name: 'Permanent', value: 'permanent' }
                        )
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('duration_remaining')
                        .setDescription('Remaining duration (in units of duration_type)')
                        .setMinValue(1)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Remove a condition from a combatant')
                .addUserOption(opt => opt.setName('target').setDescription('Target combatant').setRequired(true))
                .addStringOption(opt =>
                    opt
                        .setName('condition_type')
                        .setDescription('The condition to remove')
                        .setRequired(true)
                        .addChoices(...STORABLE_CONDITIONS)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List all active conditions on a combatant')
                .addUserOption(opt => opt.setName('target').setDescription('Target combatant (defaults to yourself)'))
        )
        .addSubcommand(sub =>
            sub
                .setName('resist-fear')
                .setDescription('Roll Willenskraft to reduce Furcht')
                .addUserOption(opt =>
                    opt.setName('target').setDescription('Target (defaults to yourself; DM may target)')
                )
                .addIntegerOption(opt =>
                    opt.setName('modifier').setDescription('Probe modifier').setMinValue(-20).setMaxValue(20)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'add':
                    return await handleAdd(interaction);
                case 'remove':
                    return await handleRemove(interaction);
                case 'list':
                    return await handleList(interaction);
                case 'resist-fear':
                    return await handleResist(interaction);
                default:
                    return interaction.editReply({ content: '❌ Unknown subcommand.' });
            }
        } catch (error) {
            log.error({ error }, 'Condition command error');
            return interaction.editReply({
                content: `❌ An error occurred: ${error.message}`,
            });
        }
    },
};
