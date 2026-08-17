const { randomUUID } = require('node:crypto');

const MAX_INITIATIVE_ENTRIES = 100;
const MAX_INITIATIVE_NAME_LENGTH = 80;
const MIN_INITIATIVE = -100;
const MAX_INITIATIVE = 500;

function normalizeInitiativeName(value, fallback = 'Initiative') {
    const name = String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    if (!name) return fallback;
    if (name.length > MAX_INITIATIVE_NAME_LENGTH) {
        throw new Error(`Name must be at most ${MAX_INITIATIVE_NAME_LENGTH} characters`);
    }
    return name;
}

function validateInitiative(value) {
    if (!Number.isInteger(value) || value < MIN_INITIATIVE || value > MAX_INITIATIVE) {
        throw new Error(`Initiative must be an integer from ${MIN_INITIATIVE} to ${MAX_INITIATIVE}`);
    }
    return value;
}

function sortInitiativeEntries(entries) {
    return [...entries].sort(
        (left, right) =>
            right.total - left.total ||
            right.baseInitiative - left.baseInitiative ||
            left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    );
}

function createPartyInitiativeEntries(party, { rollDie, createId = randomUUID } = {}) {
    const die = rollDie || (() => Math.floor(Math.random() * 6) + 1);
    if (party.length > MAX_INITIATIVE_ENTRIES) {
        throw new Error(`An initiative tracker supports at most ${MAX_INITIATIVE_ENTRIES} entries`);
    }

    return sortInitiativeEntries(
        party.map(character => {
            const roll = die();
            if (!Number.isInteger(roll) || roll < 1 || roll > 6)
                throw new Error('Initiative die must roll from 1 to 6');
            const baseInitiative = validateInitiative(character.initiative ?? 0);
            return {
                id: createId(),
                characterId: character.playerId,
                discordId: character.discordId,
                name: normalizeInitiativeName(character.name, 'Unnamed character'),
                baseInitiative,
                roll,
                total: baseInitiative + roll,
            };
        })
    );
}

function addEntryToTracker(tracker, input, createId = randomUUID) {
    const entries = Array.isArray(tracker.entries) ? tracker.entries : [];
    if (entries.length >= MAX_INITIATIVE_ENTRIES) {
        throw new Error(`An initiative tracker supports at most ${MAX_INITIATIVE_ENTRIES} entries`);
    }
    const activeId = entries[tracker.current_entry_index]?.id;
    const total = validateInitiative(input.initiative);
    const nextEntries = sortInitiativeEntries([
        ...entries,
        {
            id: createId(),
            characterId: null,
            discordId: null,
            name: normalizeInitiativeName(input.name, 'Unnamed participant'),
            baseInitiative: total,
            roll: null,
            total,
        },
    ]);
    const currentEntryIndex = activeId ? nextEntries.findIndex(entry => entry.id === activeId) : 0;
    return { entries: nextEntries, current_entry_index: Math.max(0, currentEntryIndex) };
}

function removeEntryFromTracker(tracker, entryId) {
    const entries = Array.isArray(tracker.entries) ? tracker.entries : [];
    const removeIndex = entries.findIndex(entry => entry.id === entryId);
    if (removeIndex === -1) throw new Error('Initiative entry not found');

    const activeId = entries[tracker.current_entry_index]?.id;
    const nextEntries = entries.filter(entry => entry.id !== entryId);
    let currentEntryIndex = 0;
    if (activeId && activeId !== entryId) {
        currentEntryIndex = Math.max(
            0,
            nextEntries.findIndex(entry => entry.id === activeId)
        );
    } else if (nextEntries.length) {
        currentEntryIndex = Math.min(removeIndex, nextEntries.length - 1);
    }
    return { entries: nextEntries, current_entry_index: currentEntryIndex };
}

function advanceInitiativeTracker(tracker) {
    const entries = Array.isArray(tracker.entries) ? tracker.entries : [];
    if (!entries.length) throw new Error('Add at least one initiative entry before advancing');
    const nextIndex = (tracker.current_entry_index + 1) % entries.length;
    return {
        current_entry_index: nextIndex,
        current_round: Math.max(1, tracker.current_round || 1) + (nextIndex === 0 ? 1 : 0),
    };
}

module.exports = {
    MAX_INITIATIVE_ENTRIES,
    addEntryToTracker,
    advanceInitiativeTracker,
    createPartyInitiativeEntries,
    normalizeInitiativeName,
    removeEntryFromTracker,
    sortInitiativeEntries,
};
