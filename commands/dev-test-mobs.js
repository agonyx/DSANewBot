const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../db');
const { mobs } = require('../db/schema');

const testMobs = [
    {
        name: 'Goblin Shaman',
        description: 'A cunning goblin with basic magical abilities.',
        base_max_hp: 15,
        base_initiative: 12,
        base_attack_value: 9,
        base_parry_value: 7,
        base_armor_soak: 1,
        base_damage_tp: '1w6+1',
    },
    {
        name: 'Orc Grunt',
        description: 'A brutish warrior, strong but not very bright.',
        base_max_hp: 30,
        base_initiative: 8,
        base_attack_value: 13,
        base_parry_value: 10,
        base_armor_soak: 3,
        base_damage_tp: '1w6+4',
    },
    {
        name: 'Forest Spider',
        description: 'A large, venomous spider that lurks in the woods.',
        base_max_hp: 22,
        base_initiative: 15,
        base_attack_value: 12,
        base_parry_value: 8,
        base_armor_soak: 2,
        base_damage_tp: '1w6+2',
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dev-test-mobs')
        .setDescription('[DEV ONLY] Creates a set of standard test mobs in the database.'),
    async execute(interaction) {
        if (process.env.DEV_MODE !== 'true') {
            return interaction.reply({
                content: '❌ This command is only available in development mode.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const mob of testMobs) {
            try {
                // mobs.name is UNIQUE — onConflictDoNothing + returning tells us if it inserted.
                const inserted = await db
                    .insert(mobs)
                    .values(mob)
                    .onConflictDoNothing({ target: mobs.name })
                    .returning({ id: mobs.id });

                if (inserted.length) {
                    results.push(`✅ Successfully created **${mob.name}**.`);
                    successCount++;
                } else {
                    results.push(`❌ Failed to create **${mob.name}** (Mob with this name already exists).`);
                    failCount++;
                }
            } catch (error) {
                results.push(`❌ Failed to create **${mob.name}** (${error.message}).`);
                failCount++;
            }
        }

        const replyMessage =
            `**Test Mob Setup Complete**\n\n` +
            `- **Successful:** ${successCount}\n` +
            `- **Failed:** ${failCount}\n\n` +
            results.join('\n');

        await interaction.editReply({ content: replyMessage });
    },
};
