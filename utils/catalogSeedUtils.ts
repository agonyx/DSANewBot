import { createHash } from 'node:crypto';

interface CatalogRow {
    external_id: string;
    source_url?: string | null;
}

export interface CanonicalCatalog<T> {
    rows: T[];
    deduplicated: number;
    disambiguated: number;
}

function compareRows<T extends CatalogRow>(left: T, right: T): number {
    return (
        (left.source_url ?? '').localeCompare(right.source_url ?? '') ||
        JSON.stringify(left).localeCompare(JSON.stringify(right))
    );
}

/**
 * Makes a source catalog safe for an external-ID upsert. Identical aliases are
 * collapsed, while callers may retain genuine ID collisions under stable IDs.
 */
export function canonicalizeCatalogRows<T extends CatalogRow>(
    input: T[],
    semanticSignature: (row: T) => string,
    allowDistinctVariants = false
): CanonicalCatalog<T> {
    const byExternalId = new Map<string, T[]>();
    for (const row of input) {
        const group = byExternalId.get(row.external_id) ?? [];
        group.push(row);
        byExternalId.set(row.external_id, group);
    }

    const rows: T[] = [];
    let deduplicated = 0;
    let disambiguated = 0;

    for (const externalId of [...byExternalId.keys()].sort()) {
        const variants = new Map<string, T[]>();
        for (const row of byExternalId.get(externalId) ?? []) {
            const signature = semanticSignature(row);
            const aliases = variants.get(signature) ?? [];
            aliases.push(row);
            variants.set(signature, aliases);
        }

        const canonicalVariants = [...variants.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([signature, aliases]) => {
                aliases.sort(compareRows);
                deduplicated += aliases.length - 1;
                return { signature, row: aliases[0] };
            });

        if (canonicalVariants.length > 1 && !allowDistinctVariants) {
            throw new Error(`Catalog external ID ${externalId} maps to distinct rules`);
        }

        canonicalVariants.forEach(({ signature, row }, index) => {
            if (index === 0) {
                rows.push(row);
                return;
            }
            const suffix = createHash('sha256').update(signature).digest('hex').slice(0, 12);
            rows.push({ ...row, external_id: `${externalId}__${suffix}` });
            disambiguated += 1;
        });
    }

    return { rows, deduplicated, disambiguated };
}
