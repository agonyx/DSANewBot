const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../db');
const { eq, and, inArray } = require('drizzle-orm');
const { players, stats, weapons, playerActionModifications, actionModifications } = require('../db/schema');
const { resolveAttack, parseAndRollDamage, applySoak, resolveDefense } = require('../utils/combatUtils');
const {
    applyWoundDamage,
    calculateWoundPenalty,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} = require('../utils/woundUtils');
const { createLogger } = require('../utils/logger');
const { createEmbed } = require('../utils/embedUtils');
const log = createLogger('attack');

async function getPlayerData(discordId) {
    let player, statsRow, weaponsRows;
    try {
        [player] = await db
            .select({ id: players.id, name: players.name })
            .from(players)
            .where(and(eq(players.discord_id, discordId), eq(players.selected, 'YES')))
            .limit(1);

        if (!player) {
            throw new Error(`Incomplete character data. Please ensure you have a character with stats and weapons.`);
        }

        [statsRow] = await db.select().from(stats).where(eq(stats.player_id, player.id)).limit(1);
        weaponsRows = await db.select().from(weapons).where(eq(weapons.player_id, player.id));

        if (!statsRow) {
            throw new Error(`Incomplete character data. Please ensure you have a character with stats and weapons.`);
        }
    } catch (error) {
        if (error.message?.includes('Incomplete')) throw error;
        throw new Error(`No character selected for the user with ID ${discordId}. Use \`/character select\`.`, {
            cause: error,
        });
    }

    const offensiveWeapon = weaponsRows.find(
        w => w.is_equipped === 'Y' && (w.equipped_slot === 'OFFENSE' || w.equipped_slot === 'ADAPTIVE')
    );
    const defensiveWeapon = weaponsRows.find(
        w => w.is_equipped === 'Y' && (w.equipped_slot === 'DEFENSE' || w.equipped_slot === 'ADAPTIVE')
    );

    const at = offensiveWeapon ? offensiveWeapon.at : statsRow.attacke_basis || 8;
    const tp = offensiveWeapon ? offensiveWeapon.tp : '1w6';
    const pa = defensiveWeapon ? defensiveWeapon.pa : statsRow.parade_basis || 6;
    const rs = statsRow.ruestungsschutz || 0;

    return {
        id: player.id,
        name: player.name,
        statsId: statsRow.id,
        currentHP: statsRow.le_current,
        maxHP: statsRow.le_max,
        wounds: statsRow.wounds,
        woundThreshold: calculateWoundThreshold(statsRow.ko, statsRow.wound_threshold_modifier),
        effectiveStats: {
            currentAT: at,
            currentPA: pa,
            currentRS: rs,
            currentTP: tp,
        },
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('attack')
        .setDescription('Performs a standalone attack against a target, outside of formal combat.')
        .addUserOption(option => option.setName('target').setDescription('The target of your attack').setRequired(true))
        .addStringOption(option =>
            option
                .setName('maneuver')
                .setDescription('The combat maneuver to use (optional)')
                .setAutocomplete(true)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const { user } = interaction;

        try {
            const [player] = await db
                .select({ id: players.id })
                .from(players)
                .where(and(eq(players.discord_id, user.id), eq(players.selected, 'YES')))
                .limit(1);

            if (!player) return await interaction.respond([]);

            const pams = await db
                .select({ action_modification_id: playerActionModifications.action_modification_id })
                .from(playerActionModifications)
                .where(eq(playerActionModifications.player_id, player.id));

            const ids = pams.map(p => p.action_modification_id);
            let meleeSkills = [];
            if (ids.length) {
                const ams = await db
                    .select({
                        id: actionModifications.id,
                        name: actionModifications.name,
                        action_type: actionModifications.action_type,
                    })
                    .from(actionModifications)
                    .where(inArray(actionModifications.id, ids));
                meleeSkills = ams.filter(s => s.action_type === 'MELEE');
            }

            const choices = meleeSkills.map(skill => ({ name: skill.name, value: skill.id }));
            const filtered = choices.filter(choice => choice.name.toLowerCase().startsWith(focusedValue.toLowerCase()));

            await interaction.respond(filtered);
        } catch (error) {
            log.error({ error }, 'Error during maneuver autocomplete');
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { user: attackerUser } = interaction;
        const targetUser = interaction.options.getUser('target');
        const maneuverId = interaction.options.getString('maneuver');

        if (attackerUser.id === targetUser.id) {
            return interaction.editReply('❌ You cannot attack yourself.');
        }
        if (targetUser.bot) {
            return interaction.editReply("❌ You can't attack a bot.");
        }

        try {
            const attacker = await getPlayerData(attackerUser.id);
            const target = await getPlayerData(targetUser.id);

            if (isIncapacitatedByWounds(attacker.wounds)) {
                return interaction.editReply(
                    `❌ ${attacker.name} is incapacitated by ${attacker.wounds} wounds and cannot attack.`
                );
            }

            if (target.currentHP <= 0) {
                return interaction.editReply(`❌ ${target.name} is already defeated!`);
            }

            let maneuver = null;
            if (maneuverId) {
                const [maneuverData] = await db
                    .select()
                    .from(actionModifications)
                    .where(eq(actionModifications.id, maneuverId))
                    .limit(1);
                maneuver = maneuverData || null;
            }

            const attackerWoundPenalty = calculateWoundPenalty(attacker.wounds);
            const targetWoundPenalty = calculateWoundPenalty(target.wounds);
            let atValue = Math.max(0, attacker.effectiveStats.currentAT - attackerWoundPenalty);
            let paValue = Math.max(0, target.effectiveStats.currentPA - targetWoundPenalty);
            let damageBonus = 0;
            let description = `**${attacker.name}** attacks **${target.name}**!\n\n`;

            if (maneuver) {
                description = `**${attacker.name}** uses **${maneuver.name}** to attack **${target.name}**!\n\n`;
                if (maneuver.rules?.at_modifier) atValue += maneuver.rules.at_modifier;
                if (maneuver.rules?.opponent_pa_modifier) paValue += maneuver.rules.opponent_pa_modifier;
                if (maneuver.rules?.damage_bonus) damageBonus += maneuver.rules.damage_bonus;
            }

            const attackResult = resolveAttack(atValue);
            description += `⚔️ **Attack Roll:** ${attackResult.roll} / ${atValue}`;
            if (attackResult.confirmRoll !== null) description += ` (Confirm: ${attackResult.confirmRoll})`;

            let hitConnected = false;
            switch (attackResult.outcome) {
                case 'BOTCH':
                    description += ` ➡️ **BOTCH!**`;
                    break;
                case 'NORMAL_MISS':
                    description += ` ➡️ **Miss!**`;
                    break;
                case 'CRITICAL_SUCCESS':
                    description += ` ➡️ **CRITICAL HIT!**`;
                    hitConnected = true;
                    break;
                case 'NORMAL_HIT':
                    description += ` ➡️ **Hit!**`;
                    hitConnected = true;
                    break;
            }

            if (hitConnected && !isIncapacitatedByWounds(target.wounds)) {
                const defenseResult = resolveDefense(paValue);
                description += `\n🛡️ **${target.name}'s Parry:** ${defenseResult.roll} / ${paValue}`;
                if (defenseResult.success) {
                    description += ` ➡️ **Parried!**`;
                    hitConnected = false;
                } else {
                    description += ` ➡️ Parry Failed.`;
                }
            }

            if (hitConnected) {
                let rolledDamage = parseAndRollDamage(attacker.effectiveStats.currentTP);
                if (attackResult.outcome === 'CRITICAL_SUCCESS') rolledDamage *= 2;

                const totalDamage = rolledDamage + damageBonus;
                const finalDamage = applySoak(totalDamage, target.effectiveStats.currentRS);

                description += `\n💥 **Damage:** ${totalDamage} TP - ${target.effectiveStats.currentRS} RS = **${finalDamage} Damage!**`;

                const newHP = target.currentHP - finalDamage;
                const woundResult = applyWoundDamage(target.wounds, finalDamage, target.woundThreshold);

                if (newHP !== target.currentHP) {
                    try {
                        await db
                            .update(stats)
                            .set({ le_current: newHP, wounds: woundResult.totalWounds })
                            .where(eq(stats.id, target.statsId));
                    } catch (updateError) {
                        log.error({ error: updateError }, 'Failed to update target HP');
                    }

                    description += `\n❤️ **${target.name}'s HP:** ${newHP} / ${target.maxHP}`;
                    if (woundResult.woundsInflicted > 0) {
                        description += `\n🩸 **Wounds:** +${woundResult.woundsInflicted} (${woundResult.totalWounds} total; threshold ${woundResult.woundThreshold})`;
                        if (isIncapacitatedByWounds(woundResult.totalWounds)) {
                            description += ' — **incapacitated**';
                        }
                    }
                    if (newHP <= 0) {
                        description += `\n\n**${target.name} has been defeated!**`;
                    }
                } else {
                    description += '\n\nNo damage was taken after soak.';
                }
            }

            const resultEmbed = createEmbed(hitConnected ? 'success' : 'danger')
                .setTitle('Standalone Attack Resolution')
                .setDescription(description)
                .setTimestamp();

            await interaction.editReply({ embeds: [resultEmbed] });
        } catch (error) {
            log.error({ error }, 'Error executing standalone attack command');
            const errorMessage = error.message || 'An unknown error occurred.';
            await interaction.editReply(`❌ ${errorMessage}`);
        }
    },
};
