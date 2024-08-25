const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config(); // Load environment variables

module.exports = {
    data: new SlashCommandBuilder()
        .setName('showweapons')
        .setDescription('Displays the weapons of your selected character.')
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

            const weaponEmbed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`**${player.name} - Weapons**`)
                .setDescription('Here are the weapons your character currently has:\n\u200B')
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.avatarURL() });

            // Sort weapons by type: melee first, then ranged
            const meleeWeapons = weapons.filter(weapon => weapon.type === 'MELEE');
            const rangedWeapons = weapons.filter(weapon => weapon.type === 'RANGED');

            // Prepare columns
            let meleeColumn = '';
            let rangedColumn = '';

            // Add melee weapons to the melee column
            if (meleeWeapons.length > 0) {
                meleeColumn += '**Melee Weapons**\n\n';
                meleeWeapons.forEach(weapon => {
                    meleeColumn += `**${weapon.name}**\nType: ${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)}\nDamage: ${weapon.tp}\nAT: ${weapon.at}\nPA: ${weapon.pa}\nEquipped: ${weapon.isEquipped === "Y" ? "Yes" : "No"}\nSlot: ${weapon.equippedSlot || 'N/A'}\n\u200B\n`;
                });
            }

            // Add ranged weapons to the ranged column
            if (rangedWeapons.length > 0) {
                rangedColumn += '**Ranged Weapons**\n\n';
                rangedWeapons.forEach(weapon => {
                    rangedColumn += `**${weapon.name}**\nType: ${weapon.type.charAt(0).toUpperCase() + weapon.type.slice(1)}\nDamage: ${weapon.tp}\nAT: ${weapon.at}\nPA: ${weapon.pa}\nEquipped: ${weapon.isEquipped === "Y" ? "Yes" : "No"}\nSlot: ${weapon.equippedSlot || 'N/A'}\n\u200B\n`;
                });
            }

            // Add columns to embed as inline fields
            weaponEmbed.addFields(
                { name: '\u200B', value: meleeColumn, inline: true },
                { name: '\u200B', value: rangedColumn, inline: true }
            );

            if (player.avatar) {
                const avatarUrl = `${process.env.BACKEND_URL}/uploads/${player.avatar}`;

                // Download the image and attach it
                const imageResponse = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'avatar.png' });

                // Set the attached image as the thumbnail
                weaponEmbed.setThumbnail('attachment://avatar.png');

                return interaction.reply({ embeds: [weaponEmbed], files: [attachment], ephemeral: !visible });
            } else {
                return interaction.reply({ embeds: [weaponEmbed], ephemeral: !visible });
            }

        } catch (error) {
            console.error('Error showing weapons:', error);
            return interaction.reply({ content: 'There was an error while fetching your weapons.', ephemeral: true });
        }
    }
};
