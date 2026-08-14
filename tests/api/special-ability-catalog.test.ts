import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSpecialAbilityCatalog } from '../../scripts/specialAbilitySeed';
import { parseFixedApCost, parseSpecialAbility } from '../../utils/specialAbilityCatalogUtils';

describe('Regelwiki special-ability catalog parsing', () => {
    it('accepts only unambiguous fixed AP costs', () => {
        assert.equal(parseFixedApCost('15 Abenteuerpunkte'), 15);
        assert.equal(parseFixedApCost('30 Abenteuerpunkte pro Stufe'), null);
        assert.equal(parseFixedApCost('Stufe I/II: 10/15 Abenteuerpunkte'), null);
    });

    it('retains source rules and marks non-empty prerequisites for table confirmation', () => {
        const parsed = parseSpecialAbility(
            {
                id: 'test-special',
                name: 'Testsonderfertigkeit',
                url: 'https://example.invalid/special',
                subcategory: 'Allgemein',
                properties: {
                    Regel: 'A test effect.',
                    Voraussetzung: 'MU 13, passende Tradition',
                    'AP-Wert': '10 Abenteuerpunkte',
                },
            },
            'MAGICAL'
        );
        assert.equal(parsed?.ap_cost, 10);
        assert.equal(parsed?.requires_confirmation, true);
        assert.equal(parsed?.raw_properties.Voraussetzung, 'MU 13, passende Tradition');
    });

    it('loads every fixed-cost magical and karmic entry from the local export', async () => {
        const rows = await loadSpecialAbilityCatalog();
        assert.equal(rows.length, 995);
        assert.ok(rows.some(row => row.category === 'MAGICAL'));
        assert.ok(rows.some(row => row.category === 'KARMAL'));
    });
});
