const { MessageFlags } = require('discord.js');
const {
    buildAbilityComponentPayload,
    buildCharacterComponentPayload,
    buildCombatComponentPayload,
    buildCombatSetupComponentPayload,
    buildManeuverComponentPayload,
    buildNoticeComponentPayload,
    buildResourceComponentPayload,
    componentReplyFlags,
    deferForComponents,
    editComponentMessage,
    editDeferredComponents,
    messageUsesComponentsV2,
} = require('../utils/componentViews');

function serialize(payload) {
    return {
        ...payload,
        components: payload.components.map(component => component.toJSON()),
    };
}

describe('Components V2 pilot payloads', () => {
    test('combat, ability, and character builders serialize within component limits', () => {
        const payloads = [
            buildCombatComponentPayload(
                {
                    currentRound: 1,
                    currentTurnIndex: 0,
                    turnOrder: ['a'],
                    combatants: [{ id: 'a', name: 'Hero', currentHP: 20, maxHP: 30, allegiance: 'PLAYER_SIDE' }],
                },
                {
                    id: '00000000-0000-0000-0000-000000000000',
                    attackerName: 'Foe',
                    targetName: 'Hero',
                    attack: { roll: 8 },
                    atValue: 12,
                    defenseOptions: [
                        { choice: 'PARRY', available: true, effectiveValue: 10 },
                        { choice: 'DODGE', available: true, effectiveValue: 8 },
                    ],
                }
            ),
            buildAbilityComponentPayload(
                { name: 'Spell', description: 'Effect', probe: 'MU/KL/IN', resourceCost: 4 },
                { success: true, qualityLevel: 2, paidCost: 4, resourceAfter: 10 }
            ),
            buildCharacterComponentPayload({ player: { name: 'Hero' }, stats: { mu: 14, le_current: 20, le_max: 30 } }),
            buildCombatSetupComponentPayload(
                '00000000-0000-0000-0000-000000000000',
                'Game Master',
                [
                    { name: 'Hero', type: 'PLAYER', allegiance: 'PLAYER_SIDE', current_hp: 20, max_hp: 30 },
                    { name: 'Foe', type: 'NPC', allegiance: 'HOSTILE', current_hp: 15, max_hp: 15 },
                ],
                true
            ),
            buildManeuverComponentPayload({
                name: 'Entwaffnen',
                description: 'Disarm the target.',
                action_type: 'MELEE',
                ap_cost: 40,
                prerequisites: { ge: 15 },
                rules: { type: 'disarm', at_modifier: -4 },
            }),
            buildResourceComponentPayload(
                'Hero',
                { label: 'Astralpunkte', emoji: '✨', color: 0x9b59b6 },
                20,
                12,
                30,
                'spend'
            ),
            buildNoticeComponentPayload('Something happened.'),
        ];
        for (const payload of payloads) {
            const json = serialize(payload);
            expect(json.flags & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
            expect(json.components).toHaveLength(1);
            expect(json.components[0].components.length).toBeLessThanOrEqual(40);
            expect(() => JSON.stringify(json)).not.toThrow();
        }
    });

    test('defers with the permanent V2 flag and edits without trying to change flags', async () => {
        const interaction = {
            deferReply: jest.fn(async () => undefined),
            editReply: jest.fn(async value => value),
        };
        await deferForComponents(interaction, { ephemeral: true });
        expect(interaction.deferReply).toHaveBeenCalledWith({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        const payload = buildCharacterComponentPayload({ player: { name: 'Hero' }, stats: {} }, { ephemeral: true });
        await editDeferredComponents(interaction, payload);
        expect(interaction.editReply.mock.calls[0][0].flags).toBeUndefined();
        expect(interaction.editReply.mock.calls[0][0].components).toHaveLength(1);
        expect(componentReplyFlags(false)).toBe(MessageFlags.IsComponentsV2);
    });

    test('detects and edits permanent V2 messages without resending flags', async () => {
        const message = {
            flags: { has: flag => flag === MessageFlags.IsComponentsV2 },
            edit: jest.fn(async value => value),
        };
        expect(messageUsesComponentsV2(message)).toBe(true);
        await editComponentMessage(message, buildNoticeComponentPayload('Updated'));
        expect(message.edit.mock.calls[0][0].flags).toBeUndefined();
        expect(message.edit.mock.calls[0][0].components).toHaveLength(1);
    });
});
