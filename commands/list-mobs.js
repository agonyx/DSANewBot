const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listMobs } = require('../services/mobs');
const { createLogger } = require('../utils/logger');
const log = createLogger('list-mobs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-mobs')
        .setDescription('Lists available mob templates defined for combat.')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const mobRows = await listMobs({ discordId: interaction.user.id });

            if (!mobRows || mobRows.length === 0) {
                await interaction.editReply(
                    'ℹ️ No mob templates have been defined yet. Use `/mob add` to create some.'
                );
                return;
            }

            const listEmbed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle('👾 Available Mob Templates 👾')
                .setDescription(`Found ${mobRows.length} mob template(s).`)
                .setTimestamp();

            const fieldsToShow = mobRows.slice(0, 15).map(mob => {
                const hp = mob.base_max_hp ?? 'N/A';
                const ini = mob.base_initiative ?? 'N/A';
                const atk = mob.base_attack_value ?? 'N/A';
                const par = mob.base_parry_value ?? 'N/A';
                const arm = mob.base_armor_soak ?? 'N/A';
                const dmg = mob.base_damage_tp ?? 'N/A';
                const desc = mob.description
                    ? `\n*${mob.description.substring(0, 100)}${mob.description.length > 100 ? '...' : ''}*`
                    : '';

                return {
                    name: `🔹 ${mob.name}`,
                    value: `**HP:** ${hp} | **INI:** ${ini} | **AT:** ${atk} | **PA:** ${par} | **RS:** ${arm} | **TP:** ${dmg}${desc}`,
                    inline: false,
                };
            });
            listEmbed.addFields(fieldsToShow);

            if (mobRows.length > 15) {
                listEmbed.setFooter({ text: `Displaying ${fieldsToShow.length} of ${mobRows.length} total mobs.` });
            } else {
                listEmbed.setFooter({ text: `Total mobs: ${mobRows.length}` });
            }

            await interaction.editReply({ embeds: [listEmbed] });
        } catch (error) {
            log.error({ error }, 'Error executing /list-mobs');
            await interaction.editReply({ content: `❌ Error: ${error.message || 'Failed to fetch mob list.'}` });
        }
    },
};
