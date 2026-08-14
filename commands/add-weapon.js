const { SlashCommandBuilder } = require('discord.js');
const { addWeapon } = require('../services/inventory');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const log = createLogger('add-weapon');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-weapon')
        .setDescription('Add a new weapon to your character')
        .addStringOption(option => option.setName('name').setDescription('Weapon name').setRequired(true))
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Weapon type')
                .setRequired(true)
                .addChoices({ name: 'MELEE', value: 'MELEE' }, { name: 'RANGED', value: 'RANGED' })
        )
        .addStringOption(option =>
            option.setName('tp').setDescription('Damage formula (e.g., 1w6+3)').setRequired(true)
        )
        .addIntegerOption(option => option.setName('at').setDescription('Attack value').setRequired(true))
        .addIntegerOption(option => option.setName('pa').setDescription('Parry value').setRequired(true))
        .addStringOption(option =>
            option.setName('technique').setDescription('Combat technique (for maneuver prerequisites)')
        )
        .addIntegerOption(option =>
            option.setName('range_close').setDescription('Close range (ranged only)').setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('range_medium').setDescription('Medium range (ranged only)').setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('range_far').setDescription('Far range (ranged only)').setMinValue(1)
        )
        .addIntegerOption(option =>
            option
                .setName('reload_actions')
                .setDescription('Reload actions (ranged only)')
                .setMinValue(0)
                .setMaxValue(20)
        )
        .addBooleanOption(option => option.setName('two_handed').setDescription('Requires two hands'))
        .addIntegerOption(option =>
            option.setName('price_kreuzer').setDescription('Weapon value in Kreuzer').setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('weight_grams').setDescription('Weapon weight in grams').setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('shield_pa_bonus').setDescription('Passive shield PA bonus').setMinValue(0).setMaxValue(10)
        )
        .addStringOption(option =>
            option
                .setName('equipped')
                .setDescription('Equip this weapon?')
                .addChoices({ name: 'Y', value: 'Y' }, { name: 'N', value: 'N' })
        )
        .addStringOption(option =>
            option
                .setName('slot')
                .setDescription('Equipment slot')
                .addChoices(
                    { name: 'ADAPTIVE', value: 'ADAPTIVE' },
                    { name: 'OFFENSE', value: 'OFFENSE' },
                    { name: 'DEFENSE', value: 'DEFENSE' }
                )
        ),
    async execute(interaction) {
        try {
            const weapon = await addWeapon(
                { discordId: interaction.user.id },
                {
                    name: interaction.options.getString('name'),
                    type: interaction.options.getString('type'),
                    combatTechnique: interaction.options.getString('technique'),
                    tp: interaction.options.getString('tp'),
                    at: interaction.options.getInteger('at'),
                    pa: interaction.options.getInteger('pa'),
                    rangeClose: interaction.options.getInteger('range_close'),
                    rangeMedium: interaction.options.getInteger('range_medium'),
                    rangeFar: interaction.options.getInteger('range_far'),
                    reloadActions: interaction.options.getInteger('reload_actions') ?? undefined,
                    isTwoHanded: interaction.options.getBoolean('two_handed') || false,
                    priceKreuzer: interaction.options.getInteger('price_kreuzer') || 0,
                    weightGrams: interaction.options.getInteger('weight_grams') || 0,
                    shieldPaBonus: interaction.options.getInteger('shield_pa_bonus') || 0,
                    is_equipped: interaction.options.getString('equipped') || 'N',
                    equipped_slot: interaction.options.getString('slot') || null,
                }
            );

            const embed = createEmbed('success')
                .setTitle('Weapon Added Successfully')
                .addFields(
                    { name: 'Name', value: weapon.name, inline: true },
                    { name: 'Type', value: weapon.type, inline: true },
                    { name: 'Technique', value: weapon.combat_technique || 'N/A', inline: true },
                    { name: 'TP', value: weapon.tp, inline: true },
                    { name: 'AT', value: weapon.at.toString(), inline: true },
                    { name: 'PA', value: weapon.pa.toString(), inline: true },
                    ...(weapon.type === 'RANGED'
                        ? [
                              {
                                  name: 'Range',
                                  value: `${weapon.range_close}/${weapon.range_medium}/${weapon.range_far}`,
                                  inline: true,
                              },
                              { name: 'Reload', value: `${weapon.reload_actions} action(s)`, inline: true },
                          ]
                        : []),
                    { name: 'Equipped', value: weapon.is_equipped, inline: true },
                    { name: 'Slot', value: weapon.equipped_slot || 'None', inline: true }
                );

            interaction.reply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Add weapon error');
            const message = error.data?.error || error.message || 'Failed to add weapon.';
            interaction.reply({ content: `❌ ${message}`, ephemeral: true });
        }
    },
};
