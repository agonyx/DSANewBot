const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const { listWeapons, equipWeapon } = require('../services/inventory');
const { createLogger } = require('../utils/logger');
const log = createLogger('equip-weapon');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equip-weapon')
        .setDescription('Equip a weapon for your selected character'),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            let weaponsList;
            try {
                weaponsList = await listWeapons({ discordId: interaction.user.id });
            } catch (error) {
                if (error.status === 404) {
                    return interaction.editReply({ content: 'No selected character!', components: [] });
                }
                throw error;
            }

            if (!weaponsList?.length) {
                return interaction.editReply({ content: 'No weapons available!', components: [] });
            }

            const weaponMenu = new StringSelectMenuBuilder()
                .setCustomId('weapon_select')
                .setPlaceholder('Select a weapon')
                .addOptions(
                    weaponsList.map(weapon => ({
                        label: weapon.name,
                        description: `${weapon.type} | TP: ${weapon.tp}`,
                        value: weapon.id.toString(),
                    }))
                );

            const message = await interaction.editReply({
                content: 'Choose a weapon to equip:',
                components: [new ActionRowBuilder().addComponents(weaponMenu)],
            });

            const weaponCollector = message.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId === 'weapon_select',
                time: 60_000,
            });

            weaponCollector.on('collect', async weaponInteraction => {
                await weaponInteraction.deferUpdate();
                const weaponId = weaponInteraction.values[0];

                const slotMenu = new StringSelectMenuBuilder()
                    .setCustomId('slot_select')
                    .setPlaceholder('Select equipment slot')
                    .addOptions([
                        { label: 'Adaptive', value: 'ADAPTIVE' },
                        { label: 'Offense', value: 'OFFENSE' },
                        { label: 'Defense', value: 'DEFENSE' },
                    ]);

                const slotMessage = await interaction.editReply({
                    content: 'Choose equipment slot:',
                    components: [new ActionRowBuilder().addComponents(slotMenu)],
                });

                const slotCollector = slotMessage.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id && i.customId === 'slot_select',
                    time: 60_000,
                });

                slotCollector.on('collect', async slotInteraction => {
                    await slotInteraction.deferUpdate();
                    const slot = slotInteraction.values[0];

                    try {
                        await equipWeapon(
                            { discordId: interaction.user.id },
                            { weaponId: parseInt(weaponId), equippedSlot: slot }
                        );

                        await interaction.editReply({
                            content: `✅ Successfully equipped ${weaponInteraction.component.options.find(o => o.value === weaponId).label} in ${slot} slot!`,
                            components: [],
                        });
                    } catch (error) {
                        log.error({ error }, 'Equip error');
                        await interaction.editReply({
                            content: `❌ ${error.data?.error || error.message || 'Failed to equip weapon!'}`,
                            components: [],
                        });
                    } finally {
                        weaponCollector.stop();
                        slotCollector.stop();
                    }
                });

                slotCollector.on('end', () => {
                    if (!slotCollector.collected.size) {
                        interaction.editReply({
                            content: '⌛ Slot selection timed out',
                            components: [],
                        });
                    }
                });
            });

            weaponCollector.on('end', () => {
                if (!weaponCollector.collected.size) {
                    interaction.editReply({
                        content: '⌛ Weapon selection timed out',
                        components: [],
                    });
                }
            });
        } catch (error) {
            log.error({ error }, 'Equip command error');
            interaction.editReply({
                content: '❌ An error occurred while processing your request',
                components: [],
            });
        }
    },
};
