const { SlashCommandBuilder } = require('discord.js');
const { listCastings, listSupernaturalEffects } = require('../services/supernatural');
const { createLogger } = require('../utils/logger');
const { buildSectionEmbeds } = require('../utils/embedUtils');

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
            return interaction.editReply({
                embeds: buildSectionEmbeds({
                    title: '🔮 Supernatural Activity',
                    description: `**${pending.length} pending · ${active.length} active**`,
                    sections: [
                        {
                            name: '⏳ Pending rituals / ceremonies',
                            lines: pending.length
                                ? pending.map(row =>
                                      row.completes_at
                                          ? `**${row.ability_name}** · completes <t:${Math.floor(row.completes_at.getTime() / 1000)}:R>`
                                          : `**${row.ability_name}** · completion time unavailable`
                                  )
                                : ['None'],
                        },
                        {
                            name: '✨ Active tracked effects',
                            lines: active.length
                                ? active.map(
                                      row => `**${row.ability_name}** · ${row.effect_type} · ${row.duration_type}`
                                  )
                                : ['None'],
                        },
                    ],
                    theme: 'magic',
                }),
            });
        } catch (error) {
            log.error({ error }, 'Supernatural activity lookup failed');
            return interaction.editReply(`❌ ${error.data?.error || error.message}`);
        }
    },
};
