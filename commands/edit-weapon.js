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
const { db } = require('../db');
const { eq, and } = require('drizzle-orm');
const { players, weapons } = require('../db/schema');
const { createLogger } = require('../utils/logger');
const { synchronizeEquipmentDerivedStatsInTransaction } = require('../services/equipment');
const log = createLogger('edit-weapon');

const WEAPON_STAT_CONFIG = [
    { key: 'name', backendKey: 'name', label: 'Name', type: 'string', style: TextInputStyle.Short },
    { key: 'type', backendKey: 'type', label: 'Type (MELEE/RANGED)', type: 'weapon_type', style: TextInputStyle.Short },
    {
        key: 'technique',
        backendKey: 'combat_technique',
        label: 'Combat Technique',
        type: 'string',
        style: TextInputStyle.Short,
    },
    {
        key: 'tp',
        backendKey: 'tp',
        label: 'Damage (TP)',
        type: 'damage',
        validationRegex: /^\d+[wW]\d+(\s*[+-]\s*\d+)?$/,
        style: TextInputStyle.Short,
    },
    { key: 'at', backendKey: 'at', label: 'Attack (AT)', type: 'integer', min: 0, style: TextInputStyle.Short },
    { key: 'pa', backendKey: 'pa', label: 'Parry (PA)', type: 'integer', min: 0, style: TextInputStyle.Short },
    {
        key: 'range_close',
        backendKey: 'range_close',
        label: 'Close Range',
        type: 'integer',
        min: 1,
        style: TextInputStyle.Short,
    },
    {
        key: 'range_medium',
        backendKey: 'range_medium',
        label: 'Medium Range',
        type: 'integer',
        min: 1,
        style: TextInputStyle.Short,
    },
    {
        key: 'range_far',
        backendKey: 'range_far',
        label: 'Far Range',
        type: 'integer',
        min: 1,
        style: TextInputStyle.Short,
    },
    {
        key: 'reload',
        backendKey: 'reload_actions',
        label: 'Reload Actions',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'two_handed',
        backendKey: 'is_two_handed',
        label: 'Two Handed (true/false)',
        type: 'boolean',
        style: TextInputStyle.Short,
    },
    { key: 'equipped', backendKey: 'is_equipped', label: 'Equipped (Y/N)', type: 'yn', style: TextInputStyle.Short },
    {
        key: 'slot',
        backendKey: 'equipped_slot',
        label: 'Slot (ADAPTIVE/OFFENSE/DEFENSE)',
        type: 'slot',
        style: TextInputStyle.Short,
    },
    {
        key: 'price',
        backendKey: 'price_kreuzer',
        label: 'Value (Kreuzer)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'weight',
        backendKey: 'weight_grams',
        label: 'Weight (grams)',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
    {
        key: 'shield_bonus',
        backendKey: 'shield_pa_bonus',
        label: 'Shield PA Bonus',
        type: 'integer',
        min: 0,
        style: TextInputStyle.Short,
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-weapon')
        .setDescription('Interactively edit a weapon on your character.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const [player] = await db
                .select({ id: players.id, name: players.name })
                .from(players)
                .where(and(eq(players.discord_id, interaction.user.id), eq(players.selected, 'YES')))
                .limit(1);

            if (!player) {
                return interaction.editReply({
                    content: 'No selected character! Use `/character select` first.',
                });
            }

            player.weapons = await db.select().from(weapons).where(eq(weapons.player_id, player.id));

            if (!player.weapons || player.weapons.length === 0) {
                return interaction.editReply({
                    content: 'Your character has no weapons to edit.',
                });
            }

            const weaponSelect = new StringSelectMenuBuilder()
                .setCustomId('editweapon_weapon_select')
                .setPlaceholder('Select a weapon to edit...')
                .addOptions(
                    player.weapons.map(w => ({
                        label: w.name,
                        description: `${w.type} | TP: ${w.tp} | AT: ${w.at} | PA: ${w.pa}`,
                        value: w.id.toString(),
                    }))
                );

            const row = new ActionRowBuilder().addComponents(weaponSelect);

            const message = await interaction.editReply({
                content: `Select a weapon to edit for **${player.name}**:`,
                components: [row],
            });

            const collector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000,
            });

            let currentWeapon = null;

            const createStatSelect = weaponData =>
                new StringSelectMenuBuilder()
                    .setCustomId('editweapon_stat_select')
                    .setPlaceholder('Select property to edit...')
                    .addOptions(
                        WEAPON_STAT_CONFIG.map(stat => ({
                            label: stat.label,
                            value: stat.key,
                            description: `Current: ${String(weaponData[stat.backendKey] ?? 'N/A').substring(0, 95)}`,
                        }))
                    );

            const createWeaponEmbed = weaponData =>
                new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle(`⚔️ Editing Weapon: ${weaponData.name}`)
                    .addFields(
                        { name: 'Type', value: weaponData.type || 'N/A', inline: true },
                        { name: 'Technique', value: weaponData.combat_technique || 'N/A', inline: true },
                        { name: 'TP', value: weaponData.tp || 'N/A', inline: true },
                        { name: 'AT', value: String(weaponData.at ?? 'N/A'), inline: true },
                        { name: 'PA', value: String(weaponData.pa ?? 'N/A'), inline: true },
                        {
                            name: 'Range',
                            value:
                                weaponData.type === 'RANGED'
                                    ? `${weaponData.range_close}/${weaponData.range_medium}/${weaponData.range_far}`
                                    : 'Melee',
                            inline: true,
                        },
                        { name: 'Reload', value: String(weaponData.reload_actions ?? 0), inline: true },
                        { name: 'Equipped', value: weaponData.is_equipped || 'N', inline: true },
                        { name: 'Slot', value: weaponData.equipped_slot || 'None', inline: true },
                        { name: 'Weight', value: `${weaponData.weight_grams ?? 0} g`, inline: true },
                        { name: 'Value', value: `${weaponData.price_kreuzer ?? 0} K`, inline: true },
                        { name: 'Shield Bonus', value: String(weaponData.shield_pa_bonus ?? 0), inline: true }
                    );

            const exitButton = new ButtonBuilder()
                .setCustomId('editweapon_exit')
                .setLabel('Exit Editor')
                .setStyle(ButtonStyle.Danger);

            const modalHandler = async modalInteraction => {
                if (!modalInteraction.isModalSubmit()) return;
                if (!modalInteraction.customId.startsWith('editweapon_modal_')) return;
                if (collector.ended) return;

                await modalInteraction.deferUpdate({ ephemeral: true });

                try {
                    const statKey = modalInteraction.customId.slice('editweapon_modal_'.length);
                    const newValue = modalInteraction.fields.getTextInputValue('value');
                    const statConfig = WEAPON_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig || !currentWeapon) return;

                    let validatedValue;
                    if (statConfig.type === 'integer') {
                        validatedValue = parseInt(newValue);
                        if (isNaN(validatedValue)) return;
                        if (statConfig.min !== undefined && validatedValue < statConfig.min) return;
                    } else if (statConfig.type === 'damage') {
                        if (!statConfig.validationRegex.test(newValue)) return;
                        validatedValue = newValue;
                    } else if (statConfig.type === 'weapon_type') {
                        const upper = newValue.toUpperCase();
                        if (upper !== 'MELEE' && upper !== 'RANGED') return;
                        validatedValue = upper;
                    } else if (statConfig.type === 'yn') {
                        const upper = newValue.toUpperCase();
                        if (upper !== 'Y' && upper !== 'N') return;
                        validatedValue = upper;
                    } else if (statConfig.type === 'boolean') {
                        if (!['true', 'false'].includes(newValue.toLowerCase())) return;
                        validatedValue = newValue.toLowerCase() === 'true';
                    } else if (statConfig.type === 'slot') {
                        if (newValue.trim() === '') {
                            validatedValue = null;
                        } else {
                            const upper = newValue.toUpperCase();
                            if (upper !== 'ADAPTIVE' && upper !== 'OFFENSE' && upper !== 'DEFENSE') return;
                            validatedValue = upper;
                        }
                    } else {
                        validatedValue = newValue.trim() || null;
                    }

                    if (currentWeapon[statConfig.backendKey] === validatedValue) return;

                    const refreshedData = await db.transaction(async tx => {
                        await tx
                            .update(weapons)
                            .set({ [statConfig.backendKey]: validatedValue })
                            .where(and(eq(weapons.id, currentWeapon.id), eq(weapons.player_id, player.id)));
                        await synchronizeEquipmentDerivedStatsInTransaction(tx, player.id);
                        const [updated] = await tx
                            .select()
                            .from(weapons)
                            .where(eq(weapons.id, currentWeapon.id))
                            .limit(1);
                        return updated;
                    });

                    if (!refreshedData) throw new Error('Weapon not found after update');
                    currentWeapon = refreshedData;

                    await interaction.editReply({
                        content: `Select a weapon to edit for **${player.name}**:`,
                        embeds: [createWeaponEmbed(currentWeapon)],
                        components: [
                            new ActionRowBuilder().addComponents(createStatSelect(currentWeapon)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });
                } catch (error) {
                    log.error({ error }, 'Modal handler error');
                }
            };

            interaction.client.on('interactionCreate', modalHandler);

            collector.on('collect', async i => {
                if (i.customId === 'editweapon_weapon_select' && i.isStringSelectMenu()) {
                    const weaponId = i.values[0];
                    currentWeapon = player.weapons.find(w => w.id.toString() === weaponId);

                    if (!currentWeapon) {
                        await i.update({ content: 'Weapon not found.', components: [] });
                        collector.stop();
                        return;
                    }

                    await i.update({
                        content: `Select a weapon to edit for **${player.name}**:`,
                        embeds: [createWeaponEmbed(currentWeapon)],
                        components: [
                            new ActionRowBuilder().addComponents(createStatSelect(currentWeapon)),
                            new ActionRowBuilder().addComponents(exitButton),
                        ],
                    });
                } else if (i.customId === 'editweapon_stat_select' && i.isStringSelectMenu()) {
                    const statKey = i.values[0];
                    const statConfig = WEAPON_STAT_CONFIG.find(s => s.key === statKey);
                    if (!statConfig || !currentWeapon) return;

                    const currentValue = currentWeapon[statConfig.backendKey];

                    const modal = new ModalBuilder()
                        .setCustomId(`editweapon_modal_${statKey}`)
                        .setTitle(`Edit ${statConfig.label}`);

                    const valueInput = new TextInputBuilder()
                        .setCustomId('value')
                        .setLabel(`Current: ${currentValue ?? 'N/A'}`)
                        .setStyle(statConfig.style)
                        .setValue(currentValue != null ? String(currentValue) : '')
                        .setRequired(false);

                    modal.addComponents(new ActionRowBuilder().addComponents(valueInput));
                    await i.showModal(modal);
                } else if (i.customId === 'editweapon_exit' && i.isButton()) {
                    await interaction.deleteReply();
                    collector.stop('user_exit');
                }
            });

            collector.on('end', (collected, reason) => {
                interaction.client.removeListener('interactionCreate', modalHandler);
                if (reason !== 'user_exit') {
                    interaction.deleteReply().catch(() => {});
                }
            });
        } catch (error) {
            log.error({ error }, 'Edit weapon error');
            interaction.editReply({
                content: 'Failed to open weapon editor.',
            });
        }
    },
};
