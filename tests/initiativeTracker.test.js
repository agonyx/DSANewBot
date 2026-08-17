const {
    addEntryToTracker,
    advanceInitiativeTracker,
    createPartyInitiativeEntries,
    removeEntryFromTracker,
} = require('../utils/initiativeTracker');

describe('non-combat initiative tracker', () => {
    test('rolls party initiative and sorts by total, base, then name', () => {
        const rolls = [2, 6, 4];
        const entries = createPartyInitiativeEntries(
            [
                { playerId: 1, discordId: 'one', name: 'Alrik', initiative: 12 },
                { playerId: 2, discordId: 'two', name: 'Boron', initiative: 8 },
                { playerId: 3, discordId: 'three', name: 'Curima', initiative: 10 },
            ],
            {
                rollDie: () => rolls.shift(),
                createId: (() => {
                    let id = 0;
                    return () => `id-${++id}`;
                })(),
            }
        );

        expect(entries.map(entry => [entry.name, entry.total])).toEqual([
            ['Alrik', 14],
            ['Curima', 14],
            ['Boron', 14],
        ]);
        expect(entries[0]).toMatchObject({ characterId: 1, baseInitiative: 12, roll: 2 });
    });

    test('manual insertion preserves the active participant after resorting', () => {
        const tracker = {
            entries: [
                { id: 'a', name: 'Alrik', total: 15, baseInitiative: 12 },
                { id: 'b', name: 'Boron', total: 10, baseInitiative: 8 },
            ],
            current_entry_index: 1,
        };
        const change = addEntryToTracker(tracker, { name: 'Dragon', initiative: 20 }, () => 'dragon');

        expect(change.entries.map(entry => entry.id)).toEqual(['dragon', 'a', 'b']);
        expect(change.current_entry_index).toBe(2);
    });

    test('advances rounds on wrap and rejects an empty tracker', () => {
        expect(
            advanceInitiativeTracker({ entries: [{ id: 'a' }, { id: 'b' }], current_entry_index: 1, current_round: 3 })
        ).toEqual({ current_entry_index: 0, current_round: 4 });
        expect(() => advanceInitiativeTracker({ entries: [], current_entry_index: 0, current_round: 1 })).toThrow(
            'Add at least one'
        );
    });

    test('removes by stable id and keeps a valid active index', () => {
        const tracker = {
            entries: [
                { id: 'a', name: 'Same name' },
                { id: 'b', name: 'Same name' },
                { id: 'c', name: 'Other' },
            ],
            current_entry_index: 1,
        };
        const change = removeEntryFromTracker(tracker, 'b');

        expect(change.entries.map(entry => entry.id)).toEqual(['a', 'c']);
        expect(change.current_entry_index).toBe(1);
    });
});
