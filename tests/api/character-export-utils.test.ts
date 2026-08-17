import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterExportFilename, formatCharacterSheetExport } from '../../utils/characterSheetExport';

const stats = {
    mu: 14,
    kl: 13,
    in: 12,
    ch: 11,
    ff: 10,
    ge: 9,
    ko: 15,
    kk: 8,
    le_current: 22,
    le_max: 30,
    asp_current: 10,
    asp_max: 20,
    kap_current: 0,
    kap_max: 0,
    schicksalspunkte_current: 2,
    schicksalspunkte_max: 3,
    initiative: 14,
    ausweichen: 7,
    attacke_basis: 8,
    parade_basis: 7,
    ruestungsschutz: 3,
    natural_armor: 1,
    belastung: 1,
    wounds: 2,
    wound_threshold_modifier: 1,
    ap_total: 1100,
    ap_available: 25,
    ap_spent: 1075,
};

describe('character sheet text export', () => {
    it('creates a safe, stable filename', () => {
        assert.equal(createCharacterExportFilename('Rána / The Brave'), 'rana-the-brave-character-sheet.txt');
        assert.equal(createCharacterExportFilename('../'), 'character-character-sheet.txt');
    });

    it('renders the selected character data into a complete deterministic sheet', () => {
        const text = formatCharacterSheetExport({
            player: { name: 'Rána' },
            stats,
            talents: [
                { talent_name: 'Sinnesschärfe', category: 'Körper', stat1: 'KL', stat2: 'IN', stat3: 'IN', ftw: 8 },
                { talent_name: 'Klettern', category: 'Körper', stat1: 'MU', stat2: 'GE', stat3: 'KK', ftw: 5 },
            ],
            weapons: [
                {
                    name: 'Sword',
                    type: 'MELEE',
                    tp: '1w6+4',
                    at: 12,
                    pa: 10,
                    is_equipped: 'Y',
                    equipped_slot: 'OFFENSE',
                },
            ],
            items: [{ name: 'Rope', type: 'GEAR', quantity: 2, is_equipped: false, equipped_slot: null }],
            specialAbilities: {
                combatAbilities: [{ name: 'Finte I', category: 'MELEE' }],
                catalogAbilities: [{ name: 'Zauberer', category: 'MAGICAL' }],
            },
            spells: [{ learned: { ftw: 7 }, spell: { name: 'Ignifaxius', kind: 'SPELL' } }],
            liturgies: [],
            profile: {
                magicalTradition: 'Gildenmagier',
                blessedTradition: null,
                deity: null,
                favoredTalents: [],
            },
            wallet: { balance: { dukaten: 2, silbertaler: 3, heller: 4, kreuzer: 5 } },
            generatedAt: new Date('2026-08-14T12:00:00.000Z'),
        });

        assert.match(text, /Name: Rána/);
        assert.match(text, /MU: 14 \(effective 12\)/);
        assert.match(text, /Wounds: 2 \(threshold 8, penalty -2\)/);
        assert.ok(text.indexOf('Klettern') < text.indexOf('Sinnesschärfe'));
        assert.match(text, /Sword \[MELEE\] TP 1w6\+4, AT 12, PA 10, equipped OFFENSE/);
        assert.match(text, /Ignifaxius \[SPELL\] FW 7/);
        assert.match(text, /2 D \/ 3 S \/ 4 H \/ 5 K/);
        assert.match(text, /Liturgies & Ceremonies\n-+\nNone/);
        assert.ok(text.endsWith('\n'));
    });
});
