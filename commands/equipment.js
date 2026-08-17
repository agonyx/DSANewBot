const { SlashCommandBuilder } = require('discord.js');
const { equipItem, getEquipmentSummary, unequipItem } = require('../services/equipment');
const { unequipWeapon } = require('../services/inventory');
const { createLogger } = require('../utils/logger');
const { createEmbed, progressBar } = require('../utils/embedUtils');
const { addVisibilityOption, deferWithVisibility } = require('../utils/interactionVisibility');
const log = createLogger('equipment');

const SLOT_CHOICES = ['HEAD', 'BODY', 'ARMS', 'HANDS', 'LEGS', 'FEET', 'BACK', 'WAIST', 'NECK', 'ACCESSORY'].map(
    slot => ({ name: slot, value: slot })
);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equipment')
        .setDescription('Show or change equipped armor, clothing, and weapons')
        .addSubcommand(command =>
            addVisibilityOption(command.setName('show').setDescription('Show equipment and carrying state'))
        )
        .addSubcommand(command =>
            command
                .setName('equip-item')
                .setDescription('Equip an owned item')
                .addIntegerOption(option => option.setName('item_id').setDescription('Item ID').setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('slot')
                        .setDescription('Override slot when the item has no default')
                        .addChoices(...SLOT_CHOICES)
                )
        )
        .addSubcommand(command =>
            command
                .setName('unequip-item')
                .setDescription('Unequip an item')
                .addIntegerOption(option => option.setName('item_id').setDescription('Item ID').setRequired(true))
        )
        .addSubcommand(command =>
            command
                .setName('unequip-weapon')
                .setDescription('Unequip a weapon')
                .addIntegerOption(option => option.setName('weapon_id').setDescription('Weapon ID').setRequired(true))
        ),

    async execute(interaction) {
        const ctx = { discordId: interaction.user.id };
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'show') await deferWithVisibility(interaction);
        else await interaction.deferReply({ ephemeral: true });
        try {
            if (subcommand === 'show') {
                const summary = await getEquipmentSummary(ctx);
                const equippedItems = summary.items.filter(item => item.is_equipped);
                const equippedWeapons = summary.weapons.filter(weapon => weapon.is_equipped === 'Y');
                const embed = createEmbed('equipment')
                    .setTitle(`🛡️ ${summary.characterName} — Equipment`)
                    .addFields(
                        {
                            name: 'Equipped items',
                            value:
                                equippedItems
                                    .map(
                                        item =>
                                            `#${item.id} ${item.name} (${item.equipped_slot}, RS ${item.armor_rs}, BE ${item.armor_be})`
                                    )
                                    .join('\n') || 'None',
                        },
                        {
                            name: 'Equipped weapons',
                            value:
                                equippedWeapons
                                    .map(weapon => `#${weapon.id} ${weapon.name} (${weapon.equipped_slot})`)
                                    .join('\n') || 'None',
                        },
                        {
                            name: 'Load',
                            value: `${progressBar(summary.state.totalWeightGrams, summary.state.carryingCapacityGrams)}\n${(summary.state.totalWeightGrams / 1000).toFixed(1)} / ${(summary.state.carryingCapacityGrams / 1000).toFixed(1)} Stein · Belastung ${summary.state.encumbrance} · RS ${summary.state.armorSoak}`,
                        }
                    );
                return interaction.editReply({ embeds: [embed] });
            }
            if (subcommand === 'equip-item') {
                const result = await equipItem(ctx, {
                    itemId: interaction.options.getInteger('item_id', true),
                    slot: interaction.options.getString('slot'),
                });
                return interaction.editReply(
                    `✅ Equipped **${result.item.name}** in ${result.item.equipped_slot}. Belastung: **${result.state.encumbrance}**, RS: **${result.state.armorSoak}**.`
                );
            }
            const result =
                subcommand === 'unequip-item'
                    ? await unequipItem(ctx, interaction.options.getInteger('item_id', true))
                    : await unequipWeapon(ctx, interaction.options.getInteger('weapon_id', true));
            return interaction.editReply(
                `✅ Unequipped **${subcommand === 'unequip-item' ? result.item.name : result.weapon.name}**. Belastung: **${result.state.encumbrance}**, RS: **${result.state.armorSoak}**.`
            );
        } catch (error) {
            log.error({ error, subcommand }, 'Equipment command failed');
            return interaction.editReply(`❌ ${error.message || 'Equipment operation failed.'}`);
        }
    },
};
