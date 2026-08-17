import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCatalogAbility,
    parseCastingMinutes,
    parseCastingActions,
    parseProbe,
    parseResourceCost,
    splitTraditions,
} from '../../utils/supernaturalCatalogUtils';

describe('Regelwiki supernatural catalog parsing', () => {
    it('extracts probe attributes, variable minimum cost, and time units', () => {
        assert.deepEqual(parseProbe('KL/IN/FF (modifiziert durch ZK)'), ['KL', 'IN', 'FF']);
        assert.deepEqual(parseResourceCost('1 AsP pro LeP, mindestens jedoch 4 AsP'), {
            cost: 4,
            permanentCost: 0,
        });
        assert.deepEqual(parseResourceCost('32 KaP, 8 davon permanent'), { cost: 32, permanentCost: 8 });
        assert.equal(parseCastingMinutes('8 Stunden'), 480);
        assert.equal(parseCastingMinutes('30 Minuten'), 30);
        assert.equal(parseCastingMinutes('2 Aktionen'), 0);
        assert.equal(parseCastingActions('16 Aktion(en)'), 16);
        assert.deepEqual(splitTraditions('Verbreitung: allgemein, Peraine, Praios (Ordnung, Antimagie)'), [
            'allgemein',
            'Peraine',
            'Praios (Ordnung, Antimagie)',
        ]);
    });

    it('maps a spell into an executable typed catalog row', () => {
        const parsed = parseCatalogAbility(
            {
                id: 'magic_Ignifaxius',
                name: 'Ignifaxius',
                url: 'https://example.invalid/ignifaxius',
                breadcrumbs: ['DSA Regel-Wiki', 'Magie', 'Zaubersprüche'],
                properties: {
                    Probe: 'MU/KL/CH',
                    'AsP-Kosten': '8 AsP',
                    Zauberdauer: '2 Aktionen',
                    Wirkungsdauer: 'sofort',
                    Verbreitung: 'Druiden, Geoden, Gildenmagier',
                    Merkmal: 'Elementar',
                    Steigerungsfaktor: 'C',
                },
            },
            'MAGIC'
        );
        assert.equal(parsed?.kind, 'SPELL');
        assert.deepEqual(parsed?.traditions, ['Druiden', 'Geoden', 'Gildenmagier']);
        assert.equal(parsed?.resource_cost, 8);
        assert.equal(parsed?.effect_type, 'DAMAGE');
        assert.equal(parsed?.effect_data.qsMultiplier, 2);
        assert.equal(parsed?.ap_cost, 3);
    });

    it('accepts rituals, liturgies, ceremonies, tricks, and blessings only', () => {
        const base = {
            id: 'x',
            name: 'Example',
            properties: { Probe: 'MU/KL/IN', Verbreitung: 'Allgemein', 'AsP-Kosten': '4 AsP' },
        };
        assert.equal(parseCatalogAbility({ ...base, breadcrumbs: ['Rituale'] }, 'MAGIC')?.kind, 'RITUAL');
        assert.equal(
            parseCatalogAbility(
                {
                    ...base,
                    breadcrumbs: ['Zeremonien'],
                    properties: { Probe: 'MU/KL/IN', Verbreitung: 'Allgemein', 'KaP-Kosten': '4 KaP' },
                },
                'KARMA'
            )?.kind,
            'CEREMONY'
        );
        assert.equal(parseCatalogAbility({ ...base, breadcrumbs: ['Talismane'] }, 'KARMA'), null);
        const blessing = parseCatalogAbility(
            {
                ...base,
                breadcrumbs: ['Segen'],
                properties: { Anmerkung: 'Verbreitung : allgemein, Peraine' },
            },
            'KARMA'
        );
        assert.equal(blessing?.resource_cost, 1);
        assert.equal(blessing?.casting_time_actions, 1);
        assert.deepEqual(blessing?.traditions, ['allgemein', 'Peraine']);
    });
});
