import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchCatalog } from '../../services/characterRecords';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('target-free attack-check contract', () => {
    it('keeps the check service read-only at the database boundary', async () => {
        const source = await readFile(resolve(root, 'services/attackChecks.ts'), 'utf8');
        assert.doesNotMatch(source, /db\s*\.\s*(insert|update|delete|transaction|execute)\s*\(/);
        assert.match(source, /db\s*\.\s*select\s*\(/);
    });
});

describe('character import transaction and catalog contracts', () => {
    it('classifies exact, normalized, alias, ambiguous, and unresolved catalog names', () => {
        const rows = [
            { id: 1, name: 'Athletik' },
            { id: 2, name: 'Überreden' },
            { id: 3, name: 'Körperbeherrschung' },
            { id: 4, name: 'Duplicaté' },
            { id: 5, name: 'Duplicate' },
        ];
        assert.deepEqual(
            matchCatalog(['Athletik', 'uberreden', 'Koerperbeherrschung', 'DUPLICATE', 'Unknown'], rows).map(
                match => match.kind
            ),
            ['exact', 'normalized', 'alias', 'ambiguous', 'unresolved']
        );
    });

    it('creates mapped character rows inside one transaction without compensating deletes', async () => {
        const source = await readFile(resolve(root, 'services/characterRecords.ts'), 'utf8');
        const start = source.indexOf('export async function importNormalizedCharacter');
        const end = source.indexOf('export async function importCharacter', start);
        const implementation = source.slice(start, end);
        assert.match(implementation, /db\.transaction\s*\(/);
        assert.doesNotMatch(implementation, /db\.delete|tx\.delete/);
    });
});
