const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createMob } = require('../services/mobs');
const { createLogger } = require('../utils/logger');
const log = createLogger('add-mob');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-mob')
        .setDescription('Defines a new reusable mob template for combat.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Unique name for the mob template (e.g., Goblin Scout, Orc Warrior)')
                .setRequired(true)
                .setMaxLength(100)
        )
        .addIntegerOption(option =>
            option.setName('hp').setDescription('Base Maximum Hit Points (LP) for this mob type').setRequired(true).setMinValue(1)
        )
        .addIntegerOption(option =>
            option.setName('initiative').setDescription('Base Initiative value (INI)').setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('attack').setDescription('Base Attack value (AT) for primary attack').setRequired(true).setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('parry').setDescription('Base Parry value (PA) for primary defense').setRequired(true).setMinValue(0)
        )
        .addIntegerOption(option =>
            option.setName('armor').setDescription('Base Armor Soak value (RS)').setRequired(true).setMinValue(0)
        )
        .addStringOption(option =>
            option.setName('damage').setDescription('Base Damage string (TP) like "1w6+2" or "2w6"').setRequired(true).setMaxLength(50)
        )
        .addStringOption(option =>
            option.setName('description').setDescription('Optional flavor text or notes for this mob').setRequired(false)
        ),

    async execute(interaction) {
        const name = interaction.options.getString('name');

        try {
            await createMob({ discordId: interaction.user.id }, {
                name,
                base_max_hp: interaction.options.getInteger('hp'),
                base_initiative: interaction.options.getInteger('initiative'),
                base_attack_value: interaction.options.getInteger('attack'),
                base_parry_value: interaction.options.getInteger('parry'),
                base_armor_soak: interaction.options.getInteger('armor'),
                base_damage_tp: interaction.options.getString('damage'),
                description: interaction.options.getString('description') || null,
            });

            await interaction.reply({ content: `✅ Mob template **${name}** created successfully!`, ephemeral: true });
        } catch (error) {
            log.error({ error, name }, 'Error creating mob template');
            const message = error.data?.error || error.message || 'Failed to create mob template.';
            await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
        }
    },
};
