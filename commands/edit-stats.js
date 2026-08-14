const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { getCharacterSheet, updateStat } = require('../services/characters');
const { createLogger } = require('../utils/logger');
const log = createLogger('edit-stats');

const STAT_CONFIG = [
    { key: 'mu', label: 'MU' },
    { key: 'kl', label: 'KL' },
    { key: 'in', label: 'IN' },
    { key: 'ch', label: 'CH' },
    { key: 'ff', label: 'FF' },
    { key: 'ge', label: 'GE' },
    { key: 'ko', label: 'KO' },
    { key: 'kk', label: 'KK' },
    { key: 'le_max', label: 'Max LP' },
    { key: 'le_current', label: 'Current LP' },
    { key: 'wounds', label: 'Wounds' },
    { key: 'wound_threshold_modifier', label: 'Wound Threshold Modifier' },
    { key: 'initiative', label: 'Initiative' },
    { key: 'ruestungsschutz', label: 'Natural + Equipped RS' },
    { key: 'ausweichen', label: 'Ausweichen' },
    { key: 'schicksalspunkte_current', label: 'SchP (Current)' },
    { key: 'schicksalspunkte_max', label: 'SchP (Max)' },
    { key: 'asp_current', label: 'AsP (Current)' },
    { key: 'asp_max', label: 'AsP (Max)' },
    { key: 'kap_current', label: 'KaP (Current)' },
    { key: 'kap_max', label: 'KaP (Max)' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-stats')
        .setDescription('Edit your character stats through an interactive interface'),
    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const { stats } = await getCharacterSheet({ discordId: interaction.user.id });

            if (!stats) {
                return interaction.editReply('❌ No character stats found! Select a character first.');
            }

            const createStatSelect = statsData =>
                new StringSelectMenuBuilder()
                    .setCustomId('stat_select')
                    .setPlaceholder('📝 Select stat to edit...')
                    .addOptions(
                        STAT_CONFIG.map(stat => ({
                            label: stat.label,
                            value: stat.key,
                            description: `Current: ${statsData[stat.key]}`,
                        }))
                    );

            const createStatsEmbed = statsData =>
                new EmbedBuilder()
                    .setColor(0x2f3136)
                    .setTitle('🔧 Character Stat Editor')
                    .setDescription('**Select a stat from the dropdown below to modify it**')
                    .addFields(
                        STAT_CONFIG.map(stat => ({
                            name: `**${stat.label}**`,
                            value: `\`${statsData[stat.key]}\``,
                            inline: true,
                        }))
                    )
                    .setFooter({ text: 'Session expires after 5 minutes of inactivity' });

            const exitButton = new ButtonBuilder()
                .setCustomId('exit_editor')
                .setLabel('❌ Exit')
                .setStyle(ButtonStyle.Danger);

            const message = await interaction.editReply({
                embeds: [createStatsEmbed(stats)],
                components: [
                    new ActionRowBuilder().addComponents(createStatSelect(stats)),
                    new ActionRowBuilder().addComponents(exitButton),
                ],
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 300_000,
            });

            collector.on('collect', async i => {
                if (i.customId === 'stat_select') {
                    const statKey = i.values[0];
                    const statConfig = STAT_CONFIG.find(s => s.key === statKey);
                    const currentValue = stats[statKey];

                    const modal = new ModalBuilder()
                        .setCustomId(`edit_${statKey}`)
                        .setTitle(`Edit ${statConfig.label}`)
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('value')
                                    .setLabel(`Current: ${currentValue}`)
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter new value...')
                                    .setValue(currentValue.toString())
                                    .setRequired(true)
                            )
                        );

                    await i.showModal(modal);
                } else if (i.customId === 'exit_editor') {
                    await i.update({
                        content: '✅ Editor closed successfully',
                        components: [],
                        embeds: [],
                    });
                    collector.stop();
                }
            });

            const modalHandler = async modalInteraction => {
                if (!modalInteraction.isModalSubmit()) return;
                if (!modalInteraction.customId.startsWith('edit_')) return;

                try {
                    const statKey = modalInteraction.customId.replace('edit_', '');
                    const newValue = modalInteraction.fields.getTextInputValue('value');
                    const parsedValue = parseInt(newValue);
                    const statLabel = STAT_CONFIG.find(s => s.key === statKey)?.label || 'Unknown Stat';

                    if (isNaN(parsedValue)) {
                        const msg = await modalInteraction.reply({
                            content: '❌ Must be a whole number!',
                            ephemeral: true,
                        });
                        setTimeout(() => msg.delete(), 3000);
                        return;
                    }

                    if (!Object.hasOwn(stats, statKey)) {
                        const msg = await modalInteraction.reply({
                            content: '❌ Invalid stat selection!',
                            ephemeral: true,
                        });
                        setTimeout(() => msg.delete(), 3000);
                        return;
                    }

                    if (stats[statKey] === parsedValue) {
                        const msg = await modalInteraction.reply({
                            content: 'ℹ️ Value unchanged',
                            ephemeral: true,
                        });
                        setTimeout(() => msg.delete(), 2000);
                        return;
                    }

                    await updateStat({ discordId: interaction.user.id }, { statKey, value: parsedValue });
                    const refreshed = await getCharacterSheet({ discordId: interaction.user.id });
                    Object.assign(stats, refreshed.stats);

                    await interaction.editReply({
                        embeds: [createStatsEmbed(stats)],
                        components: [
                            new ActionRowBuilder().addComponents(createStatSelect(stats)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });

                    const successMsg = await modalInteraction.reply({
                        content: `🔄 Updated **${statLabel}** to \`${parsedValue}\`!`,
                        ephemeral: true,
                    });

                    setTimeout(async () => {
                        await successMsg
                            .delete()
                            .catch(err => log.error({ error: err }, 'Failed to delete success message'));
                    }, 2000);
                } catch (error) {
                    log.error({ error }, 'Modal error');
                    const errorMsg = await modalInteraction.reply({
                        content: `❌ ${error.data?.error || error.message || 'Failed to update stat!'}`,
                        ephemeral: true,
                    });
                    setTimeout(() => errorMsg.delete(), 3000);
                }
            };

            interaction.client.on('interactionCreate', modalHandler);

            collector.on('end', () => {
                interaction.editReply({
                    content: '🕒 Session expired - Editor closed',
                    components: [],
                });
                interaction.client.removeListener('interactionCreate', modalHandler);
            });
        } catch (error) {
            log.error({ error }, 'EditStats error');
            interaction.editReply('❌ Failed to initialize editor!');
        }
    },
};
