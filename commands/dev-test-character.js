const { SlashCommandBuilder } = require('discord.js');
const { db, callEdgeFunction } = require('../db');
const { eq } = require('drizzle-orm');
const { stats, weapons, items } = require('../db/schema');
const { createLogger } = require('../utils/logger');
const log = createLogger('dev-test-character');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dev-test-character')
        .setDescription('[DEV ONLY] Sets up a test character with default stats, weapons, and items.'),
    async execute(interaction) {
        if (process.env.DEV_MODE !== 'true') {
            return interaction.reply({
                content: '❌ This command is only available in development mode.',
                ephemeral: true,
            });
        }

        const discordId = interaction.user.id;

        try {
            await interaction.deferReply({ ephemeral: true });

            const { data: result } = await callEdgeFunction('create-player', {
                name: 'Test Character',
                discordId: discordId,
            });

            const player = result?.player || result;
            const statsRow = result?.stats;

            if (!player?.id) {
                throw new Error('Failed to create player');
            }

            if (statsRow?.id) {
                await db
                    .update(stats)
                    .set({
                        mu: 10,
                        kl: 10,
                        in: 10,
                        ch: 10,
                        ff: 10,
                        ge: 10,
                        ko: 10,
                        kk: 10,
                        le_max: 20,
                        le_current: 20,
                        initiative: 10,
                        ruestungsschutz: 2,
                        ausweichen: 5,
                    })
                    .where(eq(stats.id, statsRow.id));
            }

            await db.insert(weapons).values([
                {
                    name: 'Test Sword',
                    type: 'MELEE',
                    tp: '1w6+2',
                    at: 12,
                    pa: 8,
                    is_equipped: 'Y',
                    equipped_slot: 'OFFENSE',
                    player_id: player.id,
                },
                {
                    name: 'Test Bow',
                    type: 'RANGED',
                    tp: '1w6+4',
                    at: 10,
                    pa: 0,
                    is_equipped: 'N',
                    player_id: player.id,
                },
            ]);

            await db.insert(items).values([
                {
                    name: 'Health Potion',
                    type: 'POTION',
                    description: 'Restores 1d6+4 health.',
                    quantity: 3,
                    player_id: player.id,
                },
                {
                    name: 'Lockpicks',
                    type: 'MISC',
                    description: 'A set of lockpicks.',
                    quantity: 1,
                    player_id: player.id,
                },
            ]);

            await interaction.editReply({ content: 'Test character created successfully!' });
        } catch (error) {
            log.error({ error }, 'Error setting up test character');
            await interaction.editReply({ content: `An error occurred: ${error.message}` });
        }
    },
};
