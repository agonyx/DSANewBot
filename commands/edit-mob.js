const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');
const { getMob, updateMob, listMobs } = require('../services/mobs');
const { createLogger } = require('../utils/logger');
const { createEmbed, truncateText } = require('../utils/embedUtils');
const log = createLogger('edit-mob');

const MOB_STAT_CONFIG = [
    { key: 'hp', backendKey: 'base_max_hp', label: 'Max HP', type: 'integer', min: 1, style: TextInputStyle.Short },
    {
        key: 'initiative',
        backendKey: 'base_initiative',
        label: 'Initiative',
        type: 'integer',
        style: TextInputStyle.Short,
    },
    {
        key: 'attack',
        backendKey: 'base_attack_value',
        label: 'Attack (AT)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'parry',
        backendKey: 'base_parry_value',
        label: 'Parry (PA)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'armor',
        backendKey: 'base_armor_soak',
        label: 'Armor (RS)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'damage',
        backendKey: 'base_damage_tp',
        label: 'Damage (TP)',
        type: 'string',
        validationRegex: /^\d+w\d+(\s*\+\s*\d+)?$/i,
        style: TextInputStyle.Short,
    },
    {
        key: 'description',
        backendKey: 'description',
        label: 'Description',
        type: 'string_long',
        style: TextInputStyle.Paragraph,
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-mob')
        .setDescription('Interactively edits an existing mob template.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('The current name of the mob template to edit.')
                .setRequired(true)
                .setMaxLength(100)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        try {
            const mobRows = await listMobs({ discordId: interaction.user.id });
            const choices = (mobRows || []).map(m => ({ name: m.name, value: m.name }));
            const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue.toLowerCase()));
            await interaction.respond(filtered.slice(0, 25));
        } catch (error) {
            log.error({ error }, 'Autocomplete error');
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        const mobNameToEdit = interaction.options.getString('name');
        const ctx = { discordId: interaction.user.id };

        try {
            await interaction.deferReply({ ephemeral: true });

            let currentMob = await getMob(ctx, mobNameToEdit);

            const createMobStatSelect = currentMobData =>
                new StringSelectMenuBuilder()
                    .setCustomId('editmob_stat_select')
                    .setPlaceholder('📝 Select mob stat...')
                    .addOptions(
                        MOB_STAT_CONFIG.map(stat => ({
                            label: stat.label,
                            value: stat.key,
                            description: `Current: ${String(currentMobData[stat.backendKey] ?? 'N/A').substring(0, 95)}`,
                        }))
                    );

            const createMobStatsEmbed = currentMobData =>
                createEmbed('combat')
                    .setTitle(`🔧 Editing Mob: ${currentMobData.name} (ID: ${currentMobData.id})`)
                    .setDescription(truncateText(currentMobData.description, 4096, '*No description.*'))
                    .addFields(
                        MOB_STAT_CONFIG.filter(s => s.key !== 'description').map(stat => ({
                            name: `**${stat.label}**`,
                            value: `\`${currentMobData[stat.backendKey] ?? 'N/A'}\``,
                            inline: true,
                        }))
                    )
                    .setFooter({ text: 'Session expires after 5 minutes' });

            const exitButton = new ButtonBuilder()
                .setCustomId('editmob_exit_editor')
                .setLabel('❌ Exit Editor')
                .setStyle(ButtonStyle.Danger);

            const message = await interaction.editReply({
                embeds: [createMobStatsEmbed(currentMob)],
                components: [
                    new ActionRowBuilder().addComponents(createMobStatSelect(currentMob)),
                    new ActionRowBuilder().addComponents(exitButton),
                ],
                fetchReply: true,
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.message.id === message.id,
                time: 300_000,
            });

            const modalHandler = async modalInteraction => {
                if (!modalInteraction.isModalSubmit()) return;
                if (!modalInteraction.customId.startsWith('editmob_modal_')) return;
                if (collector.ended) return;

                await modalInteraction.deferUpdate({ ephemeral: true });

                try {
                    const statKey = modalInteraction.customId.split('_')[2];
                    const newValue = modalInteraction.fields.getTextInputValue('value');
                    const statConfig = MOB_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig) throw new Error(`Invalid StatKey ${statKey}`);

                    let validatedValue;
                    if (statConfig.type === 'integer') {
                        validatedValue = parseInt(newValue);
                        if (isNaN(validatedValue)) return;
                        if (statConfig.min !== undefined && validatedValue < statConfig.min) return;
                    } else if (statConfig.type === 'string') {
                        validatedValue = newValue;
                        if (statConfig.validationRegex && !statConfig.validationRegex.test(validatedValue)) return;
                    } else if (statConfig.type === 'string_long') {
                        validatedValue = newValue.trim() === '' ? null : newValue;
                    } else {
                        throw new Error('Unknown stat type');
                    }

                    if (currentMob[statConfig.backendKey] === validatedValue) return;

                    currentMob = await updateMob(ctx, {
                        id: currentMob.id,
                        patch: { [statConfig.backendKey]: validatedValue },
                    });

                    await interaction.editReply({
                        embeds: [createMobStatsEmbed(currentMob)],
                        components: [
                            new ActionRowBuilder().addComponents(createMobStatSelect(currentMob)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });
                } catch (error) {
                    log.error({ error }, 'Modal handler error');
                }
            };

            interaction.client.on('interactionCreate', modalHandler);

            collector.on('collect', async i => {
                if (i.customId === 'editmob_stat_select' && i.isStringSelectMenu()) {
                    const statKey = i.values[0];
                    const statConfig = MOB_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig) return;
                    const currentValue = currentMob[statConfig.backendKey];

                    const modal = new ModalBuilder()
                        .setCustomId(`editmob_modal_${statKey}`)
                        .setTitle(`Edit ${statConfig.label} for ${currentMob.name}`);

                    const valueInput = new TextInputBuilder()
                        .setCustomId('value')
                        .setLabel(`Current: ${currentValue ?? 'N/A'}`)
                        .setStyle(statConfig.style)
                        .setPlaceholder(`Enter new ${statConfig.label}...`)
                        .setValue(currentValue != null ? String(currentValue) : '')
                        .setRequired(statConfig.key !== 'description');

                    if (statConfig.type === 'string_long') valueInput.setMinLength(0).setMaxLength(1000);
                    modal.addComponents(new ActionRowBuilder().addComponents(valueInput));
                    await i.showModal(modal);
                } else if (i.customId === 'editmob_exit_editor' && i.isButton()) {
                    try {
                        await i.update({ content: '✅ Editor closed.', components: [], embeds: [] });
                        collector.stop('user_exit');
                    } catch (exitUpdateError) {
                        log.error({ error: exitUpdateError }, 'Error updating on exit click');
                        collector.stop('exit_error');
                    }
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason !== 'user_exit') {
                    interaction
                        .editReply({
                            content: '🕒 Session expired - Editor closed',
                            embeds: [createMobStatsEmbed(currentMob)],
                            components: [],
                        })
                        .catch(e => {
                            if (e.code !== 10008) log.error({ error: e }, 'Error editing message on collector end');
                        });
                }
                interaction.client.removeListener('interactionCreate', modalHandler);
            });
        } catch (error) {
            if (error.status === 404) {
                const msg = `❌ Mob template named **${mobNameToEdit}** not found.`;
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.reply({ content: msg, ephemeral: true });
                    } else {
                        await interaction.editReply({ content: msg });
                    }
                } catch (replyError) {
                    log.error({ error: replyError }, 'Error sending not-found reply');
                }
                return;
            }
            log.error({ error, interactionId: interaction.id }, 'EditMob main error');
            const errorMsg = '❌ Failed to initialize mob editor!';
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({ content: errorMsg, ephemeral: true });
                } else {
                    await interaction.editReply({ content: errorMsg, components: [], embeds: [] });
                }
            } catch (replyError) {
                log.error({ error: replyError }, 'Error sending init error reply');
            }
        }
    },
};
