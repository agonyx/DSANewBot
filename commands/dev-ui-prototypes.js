const { SlashCommandBuilder } = require('discord.js');
const {
    buildAbilityComponentPayload,
    buildCharacterComponentPayload,
    buildCombatComponentPayload,
    buildCombatSetupComponentPayload,
    buildManeuverComponentPayload,
    buildResourceComponentPayload,
} = require('../utils/componentViews');
const { createSetupActionRows } = require('../utils/combatComponents');
const { RESOURCE_TYPES } = require('../services/resources');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dev-ui-prototypes')
        .setDescription('Render Components V2 pilot cards for Discord screenshot review')
        .addStringOption(option =>
            option
                .setName('view')
                .setDescription('Pilot view')
                .setRequired(true)
                .addChoices(
                    { name: 'Active combat + defense', value: 'combat' },
                    { name: 'Combat lobby', value: 'setup' },
                    { name: 'Spell/liturgy result', value: 'ability' },
                    { name: 'Compact character sheet', value: 'character' },
                    { name: 'Maneuver detail', value: 'maneuver' },
                    { name: 'Resource change', value: 'resource' }
                )
        ),
    async execute(interaction) {
        const view = interaction.options.getString('view', true);
        if (view === 'combat') {
            return interaction.reply(
                buildCombatComponentPayload(
                    {
                        currentRound: 3,
                        currentTurnIndex: 0,
                        turnOrder: ['hero', 'foe'],
                        combatants: [
                            { id: 'hero', name: 'Arbosch', currentHP: 24, maxHP: 31, allegiance: 'PLAYER_SIDE' },
                            { id: 'foe', name: 'Orc Raider', currentHP: 17, maxHP: 25, allegiance: 'HOSTILE' },
                        ],
                    },
                    {
                        id: '00000000-0000-0000-0000-000000000000',
                        attackerName: 'Orc Raider',
                        targetName: 'Arbosch',
                        attack: { roll: 7 },
                        atValue: 13,
                        defenseOptions: [
                            { choice: 'PARRY', available: true, effectiveValue: 10 },
                            { choice: 'DODGE', available: true, effectiveValue: 7 },
                        ],
                    }
                )
            );
        }
        if (view === 'setup') {
            return interaction.reply(
                buildCombatSetupComponentPayload(
                    '00000000-0000-0000-0000-000000000000',
                    interaction.user.username,
                    [
                        { name: 'Arbosch', type: 'PLAYER', allegiance: 'PLAYER_SIDE', current_hp: 24, max_hp: 31 },
                        { name: 'Orc Raider', type: 'NPC', allegiance: 'HOSTILE', current_hp: 17, max_hp: 25 },
                    ],
                    true,
                    { actionRows: createSetupActionRows('00000000-0000-0000-0000-000000000000', true) }
                )
            );
        }
        if (view === 'ability') {
            return interaction.reply(
                buildAbilityComponentPayload(
                    {
                        abilityType: 'SPELL',
                        name: 'Ignifaxius',
                        description: 'A focused lance of elemental fire strikes the target.',
                        probe: 'KL/IN/FF',
                        resourceCost: 8,
                        castingTime: '2 actions',
                        range: '16 m',
                        duration: 'Immediate',
                    },
                    { success: true, qualityLevel: 3, paidCost: 8, resourceAfter: 21 }
                )
            );
        }
        if (view === 'character') {
            return interaction.reply(
                buildCharacterComponentPayload({
                    player: { name: 'Rondriga' },
                    stats: {
                        mu: 14,
                        kl: 12,
                        in: 13,
                        ch: 11,
                        ff: 10,
                        ge: 14,
                        ko: 13,
                        kk: 12,
                        le_current: 27,
                        le_max: 31,
                        asp_current: 0,
                        asp_max: 0,
                        kap_current: 18,
                        kap_max: 24,
                        schicksalspunkte_current: 2,
                        schicksalspunkte_max: 3,
                        initiative: 14,
                        attacke_basis: 13,
                        parade_basis: 10,
                        ausweichen: 8,
                        ruestungsschutz: 3,
                    },
                })
            );
        }
        if (view === 'maneuver') {
            return interaction.reply(
                buildManeuverComponentPayload({
                    name: 'Entwaffnen',
                    description: 'Forces the target to drop its wielded weapon on a connected hit.',
                    action_type: 'MELEE',
                    ap_cost: 40,
                    prerequisites: { ge: 15 },
                    rules: { type: 'disarm', at_modifier: -4, damage: '1W3', shield_excluded: true },
                })
            );
        }
        return interaction.reply(buildResourceComponentPayload('Rondriga', RESOURCE_TYPES.asp, 21, 13, 30, 'spend'));
    },
};
