const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { listWeapons } = require('../services/inventory');
const { getSelectedPlayer } = require('../services/characters');
const { readAvatar } = require('../utils/avatarStorage');
const { createLogger } = require('../utils/logger');
const { formatCurrency } = require('../utils/economyUtils');
const log = createLogger('show-weapons');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('show-weapons')
        .setDescription('Displays the weapons of your selected character.')
        .addBooleanOption(option =>
            option.setName('visible').setDescription('Make the response visible to everyone in the channel.')
        ),
    async execute(interaction) {
        const visible = interaction.options.getBoolean('visible', false);

        try {
            const player = await getSelectedPlayer({ discordId: interaction.user.id });
            const weaponsList = await listWeapons({ discordId: interaction.user.id });

            if (!weaponsList || weaponsList.length === 0) {
                return interaction.reply({
                    content: 'Your selected player does not have any weapons.',
                    ephemeral: true,
                });
            }

            const weaponEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(`**${player.name} - Weapons**`)
                .setDescription('Here are the weapons your character currently has:\n​')
                .setFooter({
                    text: `Requested by ${interaction.user.username}`,
                    iconURL: interaction.user.avatarURL(),
                });

            const meleeWeapons = weaponsList.filter(weapon => weapon.type === 'MELEE');
            const rangedWeapons = weaponsList.filter(weapon => weapon.type === 'RANGED');

            let meleeColumn = '';
            let rangedColumn = '';

            if (meleeWeapons.length > 0) {
                meleeColumn += '**Melee Weapons**\n\n';
                meleeWeapons.forEach(weapon => {
                    meleeColumn += `**#${weapon.id} ${weapon.name}**\nType: ${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)}\nTechnique: ${weapon.combat_technique || 'N/A'}\nDamage: ${weapon.tp}\nAT: ${weapon.at}\nPA: ${weapon.pa}${weapon.shield_pa_bonus ? ` (shield +${weapon.shield_pa_bonus})` : ''}\nWeight: ${(weapon.weight_grams / 1000).toFixed(1)} Stein\nValue: ${formatCurrency(weapon.price_kreuzer)}\nHands: ${weapon.is_two_handed ? 'Two' : 'One'}\nEquipped: ${weapon.is_equipped === 'Y' ? 'Yes' : 'No'}\nSlot: ${weapon.equipped_slot || 'N/A'}\n\n`;
                });
            }

            if (rangedWeapons.length > 0) {
                rangedColumn += '**Ranged Weapons**\n\n';
                rangedWeapons.forEach(weapon => {
                    rangedColumn += `**#${weapon.id} ${weapon.name}**\nType: ${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)}\nTechnique: ${weapon.combat_technique || 'N/A'}\nDamage: ${weapon.tp}\nAT: ${weapon.at}\nPA: ${weapon.pa}\nRange: ${weapon.range_close ?? 10}/${weapon.range_medium ?? 50}/${weapon.range_far ?? 100}\nReload: ${weapon.reload_actions ?? 0} action(s)\nWeight: ${(weapon.weight_grams / 1000).toFixed(1)} Stein\nValue: ${formatCurrency(weapon.price_kreuzer)}\nHands: ${weapon.is_two_handed ? 'Two' : 'One'}\nEquipped: ${weapon.is_equipped === 'Y' ? 'Yes' : 'No'}\nSlot: ${weapon.equipped_slot || 'N/A'}\n\n`;
                });
            }

            const fields = [];
            if (meleeColumn) {
                fields.push({ name: '​', value: meleeColumn, inline: true });
            }
            if (rangedColumn) {
                fields.push({ name: '​', value: rangedColumn, inline: true });
            }

            if (fields.length > 0) {
                weaponEmbed.addFields(fields);
            }

            if (player.avatar) {
                try {
                    const avatarBuffer = await readAvatar(player.avatar);
                    if (avatarBuffer) {
                        const attachment = new AttachmentBuilder(avatarBuffer, { name: 'avatar.png' });
                        weaponEmbed.setThumbnail('attachment://avatar.png');
                        return interaction.reply({ embeds: [weaponEmbed], files: [attachment], ephemeral: !visible });
                    }
                } catch (e) {
                    // Avatar fetch failed, continue without it
                }
            }

            return interaction.reply({ embeds: [weaponEmbed], ephemeral: !visible });
        } catch (error) {
            if (error.status === 404) {
                return interaction.reply({
                    content: 'You have not selected a character yet. Use `/character select` first.',
                    ephemeral: true,
                });
            }
            log.error({ error }, 'Error showing weapons');
            return interaction.reply({ content: 'There was an error while fetching your weapons.', ephemeral: true });
        }
    },
};
