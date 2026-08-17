import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    addEncounterEntry,
    addQuestObjective,
    advanceWorldTime,
    createQuestData,
    generateNpc,
    getEncounterEntries,
    getQuestObjectives,
    normalizeEventTypes,
    rollEncounter,
    setQuestObjective,
    validateHttpsUrl,
} from '../../utils/campaignUtils';
import { advanceProgress, normalizeCharacterRecord, normalizeProgress } from '../../utils/characterRecordUtils';
import { parseCharacterImport } from '../../utils/characterImport';
import { requireDmGuild } from '../../services/guildAuth';

describe('campaign and character extension utilities', () => {
    it('builds and updates bounded quest objectives', () => {
        const quest = createQuestData(' Find the relic ', ['Search the ruins', 'Return safely']);
        assert.equal(quest.summary, 'Find the relic');
        assert.equal(getQuestObjectives(quest).length, 2);

        const withThird = addQuestObjective(quest, 'Report to the temple');
        const third = getQuestObjectives(withThird)[2];
        const completed = setQuestObjective(withThird, third.id, true);
        assert.equal(getQuestObjectives(completed)[2].completed, true);
        assert.throws(() => setQuestObjective(completed, 'missing', true), /not found/);
    });

    it('draws weighted encounter entries at both edges of the range', () => {
        let data: Record<string, unknown> = { entries: [] };
        data = addEncounterEntry(data, { name: 'Patrol', weight: 1 });
        data = addEncounterEntry(data, { name: 'Wyvern', weight: 9, details: 'Circling overhead' });
        assert.equal(getEncounterEntries(data).length, 2);
        assert.equal(rollEncounter(data, () => 0).name, 'Patrol');
        assert.equal(rollEncounter(data, () => 0.999).name, 'Wyvern');
    });

    it('rejects unsafe integration targets and unsupported event names', () => {
        assert.equal(validateHttpsUrl('https://example.test/hooks'), 'https://example.test/hooks');
        assert.throws(() => validateHttpsUrl('http://example.test/hooks'), /HTTPS/);
        assert.throws(() => validateHttpsUrl('https://127.0.0.1/hooks'), /private/);
        assert.throws(() => validateHttpsUrl('https://user:password@example.test/hooks'), /credentials/);
        assert.deepEqual(normalizeEventTypes('dice.roll, campaign.updated,dice.roll'), [
            'dice.roll',
            'campaign.updated',
        ]);
        assert.throws(() => normalizeEventTypes('database.dump'), /Events must be/);
    });

    it('generates a complete bounded NPC and advances world time', () => {
        const npc = generateNpc(() => 0);
        assert.equal(npc.name, 'Alrik');
        assert.equal(npc.stats.courage, 8);
        assert.equal(npc.stats.lifePoints, 20);

        const start = new Date('2026-08-15T12:00:00Z');
        assert.equal(advanceWorldTime(start, 2, 'HOURS').toISOString(), '2026-08-15T14:00:00.000Z');
        assert.throws(() => advanceWorldTime(start, 0, 'DAYS'), /non-zero/);
    });

    it('tracks crafting and alchemy progress without exceeding the target', () => {
        assert.deepEqual(normalizeProgress(0, 5), { progress: 0, target: 5 });
        assert.deepEqual(advanceProgress({ progress: 3, target: 5 }, 4), {
            data: { progress: 5, target: 5 },
            completed: true,
        });
        assert.throws(() => normalizeProgress(6, 5), /0 to 5/);
        assert.throws(
            () => normalizeCharacterRecord('UNKNOWN' as never, { name: 'Bad record' }),
            /Invalid character record kind/
        );
    });

    it('imports Foundry DSA5 actor exports', () => {
        const foundry = parseCharacterImport({
            name: 'Geron',
            type: 'character',
            system: {
                characteristics: Object.fromEntries(
                    ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'].map((key, index) => [key, { value: 10 + index }])
                ),
                status: {
                    wounds: { value: 28, max: 32 },
                    astralenergy: { value: 10, max: 20 },
                    karmaenergy: { value: 0, max: 0 },
                    fatePoints: { value: 2, max: 3 },
                    initiative: { value: 14 },
                    dodge: { value: 7 },
                },
                details: { culture: { value: 'Mittelreich' }, profession: { value: 'Krieger' } },
            },
        });
        assert.equal(foundry.source, 'FOUNDRY_DSA5');
        assert.equal(foundry.stats.mu, 10);
        assert.equal(foundry.stats.le_current, 28);
        assert.deepEqual(foundry.background, { culture: 'Mittelreich', profession: 'Krieger' });
    });

    it('imports the published Optolith interchange shape and native backups', () => {
        const optolith = parseCharacterImport({
            name: 'Mirhiban',
            attributes: [
                { id: 1, value: 14 },
                { id: 8, value: 12 },
            ],
            derived_characteristics: {
                life_points: { maximum: 30 },
                arcane_energy: { maximum: 35 },
                initiative: { value: 13 },
                dodge: { value: 7 },
            },
            culture: { id: 12 },
            profession: { id: 4, custom_name: 'Tulamidische Magierin' },
        });
        assert.equal(optolith.source, 'OPTOLITH');
        assert.equal(optolith.stats.mu, 14);
        assert.equal(optolith.stats.kk, 12);
        assert.equal(optolith.stats.le_current, 30);

        const native = parseCharacterImport({
            format: 'dsanewbot-character-v1',
            name: 'Alrik',
            stats: { mu: 13, le_max: 29, le_current: 25 },
        });
        assert.equal(native.source, 'DSANEWBOT');
        assert.equal(native.stats.mu, 13);
        assert.throws(() => parseCharacterImport({ name: 'Unknown' }), /Unsupported character JSON/);
    });

    it('authorizes only explicit DM or OAuth-manageable guild scopes', () => {
        assert.equal(requireDmGuild({ discordId: '1', role: 'DM' }, ' guild-1 '), 'guild-1');
        assert.equal(requireDmGuild({ discordId: '1', dmGuildIds: ['guild-2'] }, 'guild-2'), 'guild-2');
        assert.throws(() => requireDmGuild({ discordId: '1', dmGuildIds: ['guild-2'] }, 'guild-1'), /Manage Server/);
    });
});
