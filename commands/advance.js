const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    getAdvancementOptions,
    getApSummary,
    grantAp,
    learnSpecialAbility,
    raiseAttribute,
    raiseSupernaturalAbility,
    raiseTalent,
} = require('../services/advancement');
const { createLogger } = require('../utils/logger');

const log = createLogger('advance');

function abilityOption(option, name, description) {
    return option.setName(name).setDescription(description).setRequired(true).setAutocomplete(true);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('advance')
        .setDescription('Track AP and improve your selected character')
        .addSubcommand(sub => sub.setName('summary').setDescription('Show AP balances and recent transactions'))
        .addSubcommand(sub =>
            sub
                .setName('grant')
                .setDescription('Record AP awarded at the table')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('Awarded AP')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(10000)
                )
                .addStringOption(option =>
                    option.setName('reason').setDescription('Ledger reason').setRequired(true).setMaxLength(200)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('attribute')
                .setDescription('Raise an attribute by one')
                .addStringOption(option =>
                    option
                        .setName('attribute')
                        .setDescription('Attribute')
                        .setRequired(true)
                        .addChoices(
                            ...['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK'].map(value => ({
                                name: value,
                                value: value.toLowerCase(),
                            }))
                        )
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('talent')
                .setDescription('Raise a talent FW by one')
                .addStringOption(option => abilityOption(option, 'talent', 'Learned talent'))
        )
        .addSubcommand(sub =>
            sub
                .setName('spell')
                .setDescription('Raise a learned spell or ritual FW by one')
                .addStringOption(option => abilityOption(option, 'ability', 'Learned spell or ritual'))
        )
        .addSubcommand(sub =>
            sub
                .setName('liturgy')
                .setDescription('Raise a learned liturgy or ceremony FW by one')
                .addStringOption(option => abilityOption(option, 'ability', 'Learned liturgy or ceremony'))
        )
        .addSubcommand(sub =>
            sub
                .setName('special')
                .setDescription('Learn a combat, magical, or karmic special ability')
                .addStringOption(option => abilityOption(option, 'ability', 'Special ability'))
                .addBooleanOption(option =>
                    option
                        .setName('prerequisites_confirmed')
                        .setDescription('Confirm manually checked source prerequisites when required')
                )
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            const subcommand = interaction.options.getSubcommand();
            const options = await getAdvancementOptions({ discordId: interaction.user.id });
            const rows =
                subcommand === 'talent'
                    ? options.talents
                    : subcommand === 'spell'
                      ? options.spells
                      : subcommand === 'liturgy'
                        ? options.liturgies
                        : options.specialAbilities;
            const search = String(focused.value).toLowerCase();
            return interaction.respond(
                rows
                    .filter(row => row.name.toLowerCase().includes(search))
                    .slice(0, 25)
                    .map(row => ({
                        name: `${row.name}${
                            'ftw' in row
                                ? ` (FW ${row.ftw})`
                                : ` (${row.apCost} AP${row.requiresConfirmation ? ', confirm rules' : ''})`
                        }`.slice(0, 100),
                        value: String(row.id),
                    }))
            );
        } catch (error) {
            log.error({ error }, 'Advancement autocomplete failed');
            return interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'summary') {
                const summary = await getApSummary(ctx);
                const ledger = summary.ledger
                    .slice(0, 10)
                    .map(row => `${row.amount >= 0 ? '+' : ''}${row.amount} — ${row.description || row.category}`);
                const embed = new EmbedBuilder()
                    .setColor(0x3498db)
                    .setTitle(`⭐ Advancement — ${summary.characterName}`)
                    .addFields(
                        { name: 'Total AP', value: String(summary.total), inline: true },
                        { name: 'Available', value: String(summary.available), inline: true },
                        { name: 'Spent', value: String(summary.spent), inline: true },
                        { name: 'Recent ledger', value: ledger.join('\n') || 'No AP transactions yet.' }
                    );
                return interaction.editReply({ embeds: [embed] });
            }
            if (subcommand === 'grant') {
                const result = await grantAp(ctx, {
                    amount: interaction.options.getInteger('amount', true),
                    reason: interaction.options.getString('reason', true),
                });
                return interaction.editReply(
                    `✅ Added ${result.amount} AP to **${result.characterName}** (${result.balanceAfter} available).`
                );
            }
            if (subcommand === 'attribute') {
                const result = await raiseAttribute(ctx, {
                    attribute: interaction.options.getString('attribute', true),
                });
                return interaction.editReply(
                    `✅ ${result.attribute.toUpperCase()} ${result.previous} → **${result.value}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            if (subcommand === 'talent') {
                const result = await raiseTalent(ctx, {
                    talentId: Number(interaction.options.getString('talent', true)),
                });
                return interaction.editReply(
                    `✅ **${result.talent.name}** ${result.previous} → **${result.value}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            if (subcommand === 'special') {
                const result = await learnSpecialAbility(ctx, {
                    abilityId: interaction.options.getString('ability', true),
                    confirmedPrerequisites: interaction.options.getBoolean('prerequisites_confirmed') ?? false,
                });
                return interaction.editReply(
                    `✅ Learned **${result.ability.name}** for ${result.apSpent} AP (${result.apAvailable} available).`
                );
            }
            const result = await raiseSupernaturalAbility(ctx, {
                abilityType: subcommand === 'spell' ? 'SPELL' : 'LITURGY',
                abilityId: interaction.options.getString('ability', true),
            });
            return interaction.editReply(
                `✅ **${result.name}** ${result.previous} → **${result.value}** for ${result.apSpent} AP (${result.apAvailable} available).`
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Advancement command failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
