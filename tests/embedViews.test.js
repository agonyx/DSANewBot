jest.mock('../utils/economyUtils', () => ({ formatCurrency: value => `${value} K` }));
jest.mock('../utils/woundUtils', () => ({
    calculateEffectivePainLevel: (pain, suppression = 0, modifier = 0) => Math.max(0, pain - suppression + modifier),
    calculateWoundPenalty: wounds => Math.max(0, wounds),
    calculateWoundThreshold: (ko, modifier = 0) => Math.max(0, Math.floor(ko / 2) + modifier),
    isIncapacitatedByWounds: wounds => wounds >= 4,
}));

const {
    buildAbilityListEmbeds,
    buildCharacterStatsEmbed,
    buildInventoryEmbeds,
    buildManeuverDetailEmbed,
    buildManeuverListEmbeds,
    buildMobListEmbeds,
    buildWeaponEmbeds,
} = require('../utils/embedViews');

function expectValidEmbeds(embeds) {
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds.length).toBeLessThanOrEqual(10);

    for (const builder of embeds) {
        const embed = builder.toJSON();
        expect(embed.title?.length || 0).toBeLessThanOrEqual(256);
        expect(embed.description?.length || 0).toBeLessThanOrEqual(4096);
        expect(embed.fields?.length || 0).toBeLessThanOrEqual(25);
        for (const field of embed.fields || []) {
            expect(field.name.length).toBeLessThanOrEqual(256);
            expect(field.value.length).toBeLessThanOrEqual(1024);
        }
        const totalLength =
            (embed.title?.length || 0) +
            (embed.description?.length || 0) +
            (embed.footer?.text.length || 0) +
            (embed.fields || []).reduce((total, field) => total + field.name.length + field.value.length, 0);
        expect(totalLength).toBeLessThanOrEqual(6000);
    }
}

const user = { username: 'Rondra', avatarURL: () => 'https://example.test/rondra.png' };

describe('embedViews', () => {
    test('inventory summarizes units and weight and safely paginates long categories', () => {
        const items = Array.from({ length: 80 }, (_, index) => ({
            id: index + 1,
            name: `Travel item ${index + 1}`,
            type: index % 2 ? 'GEAR' : 'CONSUMABLE',
            quantity: 2,
            weight_grams: 500,
            price_kreuzer: 12,
            description: 'Useful on long expeditions through Aventuria.',
            is_equipped: false,
        }));
        const embeds = buildInventoryEmbeds({ name: 'Geron' }, items, user);
        const text = embeds.map(embed => JSON.stringify(embed.toJSON())).join('\n');

        expectValidEmbeds(embeds);
        expect(embeds[0].toJSON().description).toContain('80 stacks · 160 units · 80 Stein carried');
        expect(text).toContain('#1 · Travel item 1');
        expect(text).toContain('#80 · Travel item 80');
    });

    test('weapons use stacked mobile-readable sections instead of inline columns', () => {
        const embeds = buildWeaponEmbeds(
            { name: 'Arbosch' },
            [
                {
                    id: 1,
                    name: 'Lindwurmschläger',
                    type: 'MELEE',
                    combat_technique: 'Hiebwaffen',
                    tp: '1w6+3',
                    at: 14,
                    pa: 8,
                    is_two_handed: false,
                    is_equipped: 'Y',
                    equipped_slot: 'OFFENSE',
                    weight_grams: 1500,
                    price_kreuzer: 450,
                },
                {
                    id: 2,
                    name: 'Kurzbogen',
                    type: 'RANGED',
                    combat_technique: 'Bögen',
                    tp: '1w6+1',
                    at: 13,
                    is_two_handed: true,
                    is_equipped: 'N',
                    range_close: 10,
                    range_medium: 50,
                    range_far: 80,
                    reload_actions: 1,
                    weight_grams: 800,
                    price_kreuzer: 300,
                },
            ],
            user
        );

        expectValidEmbeds(embeds);
        expect(embeds[0].toJSON().fields.map(field => field.name)).toEqual(['⚔️ Melee', '🏹 Ranged']);
        expect(embeds[0].toJSON().fields.every(field => field.inline === false)).toBe(true);
    });

    test('character sheet separates attributes, wounds, combat, and resources', () => {
        const embed = buildCharacterStatsEmbed(
            { name: 'Mirhiban' },
            {
                mu: 14,
                kl: 15,
                in: 13,
                ch: 14,
                ff: 12,
                ge: 13,
                ko: 11,
                kk: 10,
                le_current: 20,
                le_max: 30,
                wounds: 1,
                wound_threshold_modifier: 0,
                pain_suppression: 0,
                pain_modifier: 0,
                initiative: 14,
                ausweichen: 7,
                ruestungsschutz: 2,
                natural_armor: 0,
                belastung: 1,
                schicksalspunkte_current: 2,
                schicksalspunkte_max: 3,
                ap_available: 20,
                ap_spent: 100,
                ap_total: 120,
                asp_current: 25,
                asp_max: 35,
                kap_current: 0,
                kap_max: 0,
            },
            user
        );

        expectValidEmbeds([embed]);
        expect(embed.toJSON().fields.map(field => field.name)).toEqual([
            '🧠 Attributes',
            '🏃 Physical Attributes',
            '🩸 Vitals & Wounds',
            '🛡️ Combat & Protection',
            '📊 Resources',
        ]);
    });

    test('maneuver detail renders mechanics as labeled prose, not JSON', () => {
        const embed = buildManeuverDetailEmbed({
            name: 'Wuchtschlag',
            action_type: 'MELEE',
            description: 'A forceful attack.',
            prerequisites: { kk: 13, techniques: ['Hiebwaffen', 'Schwerter'] },
            rules: { at_modifier: -2, damage_bonus: 2 },
        });
        const serialized = JSON.stringify(embed.toJSON());

        expectValidEmbeds([embed]);
        expect(serialized).toContain('**KK:** 13');
        expect(serialized).toContain('**Damage Bonus:** 2');
        expect(serialized).not.toContain('```json');
    });

    test('catalog-style views retain the final result under large inputs', () => {
        const maneuvers = Array.from({ length: 120 }, (_, index) => ({
            name: `Maneuver ${index + 1}`,
            action_type: 'MELEE',
            description: 'A concise combat rule.',
        }));
        const mobs = Array.from({ length: 120 }, (_, index) => ({
            name: `Mob ${index + 1}`,
            base_max_hp: 20,
            base_initiative: 12,
            base_attack_value: 13,
            base_parry_value: 7,
            base_armor_soak: 2,
            base_damage_tp: '1w6+2',
        }));
        const result = {
            characterName: 'Geron',
            combatAbilities: Array.from({ length: 60 }, (_, index) => ({
                name: `Ability ${index + 1}`,
                category: 'COMBAT',
                apCost: 10,
                description: 'A learned technique.',
            })),
            catalogAbilities: [],
        };

        for (const [embeds, finalResult] of [
            [buildManeuverListEmbeds(maneuvers), 'Maneuver 120'],
            [buildMobListEmbeds(mobs), 'Mob 120'],
            [buildAbilityListEmbeds(result), 'Ability 60'],
        ]) {
            expectValidEmbeds(embeds);
            expect(embeds.map(embed => embed.toJSON().description).join('\n')).toContain(finalResult);
        }
    });
});
