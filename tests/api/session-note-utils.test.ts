import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_SESSION_NOTE_BODY,
    normalizeSessionDate,
    normalizeSessionNoteBody,
    normalizeSessionNoteTitle,
} from '../../utils/sessionNoteUtils';

describe('session note validation', () => {
    it('normalizes titles, line endings, and optional dates', () => {
        assert.equal(normalizeSessionNoteTitle('  The   Raven  '), 'The Raven');
        assert.equal(normalizeSessionNoteBody('  First\r\nSecond  '), 'First\nSecond');
        assert.equal(normalizeSessionDate('2026-08-15'), '2026-08-15');
        assert.equal(normalizeSessionDate(undefined), null);
    });

    it('rejects empty, oversized, and invalid values', () => {
        assert.throws(() => normalizeSessionNoteTitle('   '), /title is required/);
        assert.throws(() => normalizeSessionNoteBody('A'.repeat(MAX_SESSION_NOTE_BODY + 1)), /at most/);
        assert.throws(() => normalizeSessionDate('2026-02-30'), /valid calendar date/);
        assert.throws(() => normalizeSessionDate('15.08.2026'), /YYYY-MM-DD/);
    });
});
