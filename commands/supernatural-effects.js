const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listCastings, listSupernaturalEffects } = require('../services/supernatural');
const { createLogger } = require('../utils/logger');

const log = createLogger('supernatural-effects');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('supernatural-effects')
        .setDescription('Show your recent castings and tracked magical or karmic effects'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const [castings, effects] = await Promise.all([
                listCastings({ discordId: interaction.user.id }),
                listSupernaturalEffects({ discordId: interaction.user.id }),
            ]);
            const pending = castings.filter(row => row.status === 'PENDING');
            const active = effects.filter(row => row.active);
            const embed = new EmbedBuilder()
                .setColor(0x5b2c6f)
                .setTitle('🔮 Supernatural Activity')
                .addFields(
                    {
                        name: 'Pending rituals / ceremonies',
                        value: pending.length
                            ? pending
                                  .map(row =>
                                      row.completes_at
                                          ? `**${row.ability_name}** — <t:${Math.floor(row.completes_at.getTime() / 1000)}:R>`
                                          : `**${row.ability_name}** — completion time unavailable`
                                  )
                                  .join('\n')
                            : 'None',
                    },
                    {
                        name: 'Active tracked effects',
                        value: active.length
                            ? active
                                  .slice(0, 15)
                                  .map(row => `**${row.ability_name}** — ${row.effect_type} (${row.duration_type})`)
                                  .join('\n')
                            : 'None',
                    }
                );
            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            log.error({ error }, 'Supernatural activity lookup failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
