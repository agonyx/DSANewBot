const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equipweapon')
        .setDescription('Equip a weapon for your selected character.')
        .addBooleanOption(option => option.setName('visible').setDescription('Make the response visible to everyone in the channel.')),
    async execute(interaction) {
        try {
            const discordId = interaction.user.id;
            const visible = interaction.options.getBoolean('visible', false);

            // Fetch the selected player and their weapons from the backend
            const playerResponse = await axios.get(`${process.env.BACKEND_URL}/player/selected/${discordId}`);
            const player = playerResponse.data;

            if (!player || !player.id) {
                return interaction.reply({ content: 'You have not selected a player yet. Use the /selectPlayer command to select a player.', ephemeral: true });
            }

            const weapons = player.weapons;

            if (!weapons || weapons.length === 0) {
                return interaction.reply({ content: 'Your selected player does not have any weapons.', ephemeral: true });
            }

            // Create a dropdown menu for selecting a weapon
            const weaponOptions = weapons.map(weapon => ({
                label: weapon.name,
                description: `Type: ${weapon.type}, Damage: ${weapon.tp}`,
                value: `${weapon.id}`,
            }));

            const weaponMenu = new StringSelectMenuBuilder()
                .setCustomId('select_weapon')
                .setPlaceholder('Select a weapon to equip')
                .addOptions(weaponOptions);

            const row = new ActionRowBuilder().addComponents(weaponMenu);

            const response = await interaction.reply({
                content: 'Select a weapon to equip:',
                components: [row],
                ephemeral: !visible,
            });

            const filter = i => i.customId === 'select_weapon' && i.user.id === interaction.user.id;
            const collector = response.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                const selectedWeaponId = i.values[0];

                // Create a modal for selecting the slot to equip the weapon
                const modal = new ModalBuilder()
                    .setCustomId('equip_weapon_modal')
                    .setTitle('Equip Weapon');

                const slotInput = new TextInputBuilder()
                    .setCustomId('equippedSlot')
                    .setLabel('Enter the slot to equip the weapon (ADAPTIVE, OFFENSE, DEFENSE):')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const modalRow = new ActionRowBuilder().addComponents(slotInput);
                modal.addComponents(modalRow);

                await i.showModal(modal);

                const modalSubmitFilter = (modalInteraction) => modalInteraction.customId === 'equip_weapon_modal' && modalInteraction.user.id === interaction.user.id;
                i.awaitModalSubmit({ filter: modalSubmitFilter, time: 60000 })
                    .then(async modalInteraction => {
                        const equippedSlot = modalInteraction.fields.getTextInputValue('equippedSlot').toUpperCase();

                        if (!['ADAPTIVE', 'OFFENSE', 'DEFENSE'].includes(equippedSlot)) {
                            return modalInteraction.reply({ content: 'Invalid slot type. Please use ADAPTIVE, OFFENSE, or DEFENSE.', ephemeral: true });
                        }

                        // Send a request to the backend to equip the selected weapon
                        try {
                            const equipResponse = await axios.post(`${process.env.BACKEND_URL}/weapon/equip/${selectedWeaponId}`, { equippedSlot });

                            await modalInteraction.reply({ content: equipResponse.data, ephemeral: !visible });
                        } catch (error) {
                            console.error('Error equipping weapon:', error);
                            await modalInteraction.reply({ content: 'There was an error while equipping the weapon.', ephemeral: true });
                        }
                    })
                    .catch(err => {
                        console.error('Modal submission failed:', err);
                        i.followUp({ content: 'You did not select a slot in time, the action has been cancelled.', ephemeral: true });
                    });
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.followUp({ content: 'You did not select a weapon in time, the action has been cancelled.', ephemeral: true });
                }
            });
        } catch (error) {
            console.error('Error during equip weapon interaction:', error);
            return interaction.reply({ content: 'There was an error while trying to equip the weapon.', ephemeral: true });
        }
    }
};
