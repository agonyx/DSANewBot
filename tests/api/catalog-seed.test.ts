import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeCatalogRows } from '../../utils/catalogSeedUtils';

interface TestRow {
    external_id: string;
    source_url: string;
    rule: string;
}

const signature = (row: TestRow) => row.rule;

describe('catalog seed canonicalization', () => {
    it('collapses source aliases before batched upserts', () => {
        const result = canonicalizeCatalogRows(
            [
                { external_id: 'shared', source_url: '/encoded', rule: 'same rule' },
                { external_id: 'shared', source_url: '/plain', rule: 'same rule' },
            ],
            signature
        );

        assert.equal(result.rows.length, 1);
        assert.equal(result.deduplicated, 1);
        assert.equal(result.disambiguated, 0);
    });

    it('rejects silent data loss when one ID maps to distinct rules', () => {
        assert.throws(
            () =>
                canonicalizeCatalogRows(
                    [
                        { external_id: 'shared', source_url: '/one', rule: 'first rule' },
                        { external_id: 'shared', source_url: '/two', rule: 'second rule' },
                    ],
                    signature
                ),
            /maps to distinct rules/
        );
    });

    it('uses stable derived IDs when distinct variants are explicitly supported', () => {
        const input = [
            { external_id: 'shared', source_url: '/one', rule: 'first rule' },
            { external_id: 'shared', source_url: '/two', rule: 'second rule' },
        ];
        const forward = canonicalizeCatalogRows(input, signature, true);
        const reversed = canonicalizeCatalogRows([...input].reverse(), signature, true);

        assert.deepEqual(forward.rows, reversed.rows);
        assert.equal(forward.rows.length, 2);
        assert.equal(new Set(forward.rows.map(row => row.external_id)).size, 2);
        assert.equal(forward.disambiguated, 1);
    });
});
