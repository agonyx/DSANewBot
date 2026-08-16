import { createHash } from 'node:crypto';
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import type { CharacterImportResult } from './characterImport';
import { normalizeName } from './campaignUtils';

export const DSA_PDF_LIMITS = {
    maxBytes: 10 * 1024 * 1024,
    maxPages: 20,
    maxFields: 5_000,
    maxParseMs: 8_000,
} as const;

export const DSA5_DOCUMENT_193_PROFILE = {
    id: 'DSA5_DOCUMENT_1_93',
    version: '1.93',
    titleIncludes: 'DSA5-Dokument V1.93',
    pageCount: 12,
    sentinels: ['Held_Name', 'MU_1', 'KL_1', 'Talent_FW_1', 'Ruestung_Name_1', 'AE_Aktuell', 'ZL_FW_1'],
    inspectedSignature: '41d800adb194b1e9fe6dcc45d82d89b438cb0f27a16a2ad80855d893186dd4a2',
    signaturePolicy: 'sentinel-compatible',
} as const;

type PdfField = ReturnType<ReturnType<PDFDocument['getForm']>['getFields']>[number];

export interface PdfFieldInventory {
    fieldCount: number;
    widgetCount: number;
    duplicateWidgetFields: number;
    countsByType: Record<string, number>;
    signature: string;
}

export interface ParsedCharacterPdf {
    profile: typeof DSA5_DOCUMENT_193_PROFILE;
    inventory: PdfFieldInventory;
    character: CharacterImportResult;
}

function fieldType(field: PdfField): string {
    if (field instanceof PDFTextField) return 'TEXT';
    if (field instanceof PDFDropdown) return 'DROPDOWN';
    if (field instanceof PDFOptionList) return 'OPTION_LIST';
    if (field instanceof PDFCheckBox) return 'CHECKBOX';
    if (field instanceof PDFRadioGroup) return 'RADIO';
    return field.constructor.name.toUpperCase();
}

function fieldValue(field: PdfField): string {
    try {
        if (field instanceof PDFTextField) return field.getText()?.trim() ?? '';
        if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
            const selected = field.getSelected();
            return (Array.isArray(selected) ? selected : [selected]).filter(Boolean).join(', ').trim();
        }
        if (field instanceof PDFCheckBox) return field.isChecked() ? 'true' : '';
        const raw = (field as unknown as { acroField?: { getValue?: () => unknown } }).acroField?.getValue?.();
        if (raw && typeof raw === 'object' && 'decodeText' in raw && typeof raw.decodeText === 'function') {
            return String(raw.decodeText()).trim();
        }
        return raw == null ? '' : String(raw).trim();
    } catch {
        return '';
    }
}

function numberValue(value: string, fallback = 0): number {
    const normalized = value
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^0-9+\-.]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function first(values: Map<string, string>, names: string[], mapped: Set<string>): string {
    for (const name of names) {
        mapped.add(name);
        const value = values.get(name)?.trim();
        if (value) return value;
    }
    return '';
}

function rows(
    values: Map<string, string>,
    mapped: Set<string>,
    count: number,
    namePattern: (index: number) => string,
    extra: Record<string, (index: number) => string> = {}
) {
    const result: Array<{ name: string; [key: string]: string }> = [];
    for (let index = 1; index <= count; index += 1) {
        const nameField = namePattern(index);
        mapped.add(nameField);
        const name = values.get(nameField)?.trim() ?? '';
        const row: { name: string; [key: string]: string } = { name };
        for (const [key, fieldName] of Object.entries(extra)) {
            const field = fieldName(index);
            mapped.add(field);
            row[key] = values.get(field)?.trim() ?? '';
        }
        if (name) result.push(row);
    }
    return result;
}

function ensureWithin(startedAt: number) {
    if (Date.now() - startedAt > DSA_PDF_LIMITS.maxParseMs) throw new Error('PDF parsing exceeded the time limit');
}

export async function parseDsaCharacterPdf(
    bytes: Uint8Array,
    options: { mimeType?: string | null } = {}
): Promise<ParsedCharacterPdf> {
    const startedAt = Date.now();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 5) throw new Error('A non-empty PDF is required');
    if (bytes.byteLength > DSA_PDF_LIMITS.maxBytes) {
        throw new Error(`PDF must be at most ${DSA_PDF_LIMITS.maxBytes} bytes`);
    }
    if (new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Attachment is not a PDF');
    if (options.mimeType && !['application/pdf', 'application/octet-stream'].includes(options.mimeType.toLowerCase())) {
        throw new Error(`Unsupported PDF MIME type: ${options.mimeType}`);
    }

    let document: PDFDocument;
    try {
        document = await PDFDocument.load(bytes, {
            ignoreEncryption: false,
            updateMetadata: false,
            throwOnInvalidObject: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'malformed input';
        throw new Error(`PDF is encrypted or malformed: ${message}`);
    }
    ensureWithin(startedAt);
    const pageCount = document.getPageCount();
    if (pageCount > DSA_PDF_LIMITS.maxPages)
        throw new Error(`PDF has ${pageCount} pages; maximum is ${DSA_PDF_LIMITS.maxPages}`);
    const fields = document.getForm().getFields();
    if (fields.length > DSA_PDF_LIMITS.maxFields) {
        throw new Error(`PDF has ${fields.length} form fields; maximum is ${DSA_PDF_LIMITS.maxFields}`);
    }
    const names = new Set(fields.map(field => field.getName()));
    const title = document.getTitle() ?? '';
    const missingSentinels = DSA5_DOCUMENT_193_PROFILE.sentinels.filter(name => !names.has(name));
    const signatureRows = fields.map(field => `${field.getName()}:${fieldType(field)}`).sort();
    const signature = createHash('sha256').update(signatureRows.join('\n')).digest('hex');
    if (
        !title.includes(DSA5_DOCUMENT_193_PROFILE.titleIncludes) ||
        pageCount !== DSA5_DOCUMENT_193_PROFILE.pageCount ||
        missingSentinels.length > 0
    ) {
        throw new Error(
            `Unsupported character PDF (title=${title || 'unknown'}, pages=${pageCount}, fields=${fields.length}, ` +
                `signature=${signature.slice(0, 16)}, missing=${missingSentinels.join(',') || 'none'})`
        );
    }

    const values = new Map(fields.map(field => [field.getName(), fieldValue(field)]));
    const mapped = new Set<string>();
    const countsByType: Record<string, number> = {};
    let widgetCount = 0;
    let duplicateWidgetFields = 0;
    for (const field of fields) {
        const type = fieldType(field);
        countsByType[type] = (countsByType[type] ?? 0) + 1;
        const widgets =
            (field as unknown as { acroField?: { getWidgets?: () => unknown[] } }).acroField?.getWidgets?.() ?? [];
        widgetCount += widgets.length;
        if (widgets.length > 1) duplicateWidgetFields += 1;
    }
    ensureWithin(startedAt);

    const stat = (names: string[], fallback = 0) => numberValue(first(values, names, mapped), fallback);
    const attributes = Object.fromEntries(
        ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'].map(key => [key, stat([`${key.toUpperCase()}_1`])])
    );
    const stats: Record<string, number> = {
        ...attributes,
        le_max: stat(['LE_Max_1', 'LE_Max_2', 'LE_Max_3']),
        le_current: stat(['LE_Aktuell_1', 'LE_Aktuell_2'], stat(['LE_Max_1', 'LE_Max_2', 'LE_Max_3'])),
        asp_max: stat(['AE_Max_1', 'AE_Max_2', 'AE_Max_3']),
        asp_current: stat(['AE_Aktuell'], stat(['AE_Max_1', 'AE_Max_2', 'AE_Max_3'])),
        kap_max: stat(['KE_Max_1', 'KE_Max_2', 'KE_Max_3']),
        kap_current: stat(['KE_Aktuell'], stat(['KE_Max_1', 'KE_Max_2', 'KE_Max_3'])),
        schicksalspunkte_max: stat(['SchiP_Max_1']),
        schicksalspunkte_current: stat(['SchiP_Aktuell_1'], stat(['SchiP_Max_1'])),
        initiative: stat(['INI_Wert_1']),
        ausweichen: stat(['AW_Wert_1']),
        seelenkraft: stat(['SK_Wert_1']),
        zaehigkeit: stat(['ZK_Wert_1']),
        ap_total: stat(['AP_gesamt', 'Gesamt_AP', 'AP_gesammelt']),
        ap_available: stat(['AP_gesamt', 'Gesamt_AP', 'AP_gesammelt']) - stat(['AP_ausgegeben']),
        ap_spent: stat(['AP_ausgegeben']),
    };

    const techniques = rows(values, mapped, 14, index => `KaT_Name_${index}`, {
        at: index => `KaT_AT_${index}`,
        pa: index => `KaT_PA_${index}`,
    }).map(row => ({ name: row.name, at: numberValue(row.at), pa: numberValue(row.pa), value: 0 }));
    stats.attacke_basis = Math.max(0, ...techniques.map(row => row.at));
    stats.parade_basis = Math.max(0, ...techniques.map(row => row.pa));

    const talentRows = rows(values, mapped, 59, index => `Talent_R_${index}`, {
        value: index => `Talent_FW_${index}`,
        notes: index => `Talent_Anmerkung_${index}`,
    }).map(row => ({ name: row.name, value: numberValue(row.value), notes: row.notes || undefined }));

    const meleeWeapons = rows(values, mapped, 4, index => `Nahwaffe_Name_${index}`, {
        technique: index => `Nah_Kampftechnik_Name_${index}`,
        tp: index => `Nah_TP_${index}`,
        at: index => `Nah_AT_${index}`,
        pa: index => `Nah_PA_${index}`,
        weight: index => `Nah_Gewicht_${index}`,
        equipped: index => `Nah_Ver_${index}`,
    }).map(row => ({
        name: row.name,
        type: 'MELEE' as const,
        combatTechnique: row.technique || undefined,
        tp: row.tp || '1w6',
        at: numberValue(row.at),
        pa: numberValue(row.pa),
        weightGrams: Math.max(0, numberValue(row.weight) * 1_000),
        isEquipped: row.equipped ? true : undefined,
    }));
    const rangedWeapons = rows(values, mapped, 4, index => `Fernwaffe_Name_${index}`, {
        technique: index => `Fern_Kampftechnik_Name_${index}`,
        tp: index => `Fern_TP_${index}`,
        at: index => `Fern_FK_${index}`,
        range: index => `Fern_Reichweite_${index}`,
        reload: index => `Fern_Ladezeit_${index}`,
        weight: index => `Fern_Gewicht_${index}`,
        equipped: index => `Fern_Ver_${index}`,
    }).map(row => {
        const ranges = row.range.split('/').map(value => numberValue(value));
        return {
            name: row.name,
            type: 'RANGED' as const,
            combatTechnique: row.technique || undefined,
            tp: row.tp || '1w6',
            at: numberValue(row.at),
            pa: 0,
            rangeClose: ranges[0] || undefined,
            rangeMedium: ranges[1] || undefined,
            rangeFar: ranges[2] || undefined,
            reloadActions: Math.max(0, numberValue(row.reload)),
            weightGrams: Math.max(0, numberValue(row.weight) * 1_000),
            isEquipped: row.equipped ? true : undefined,
        };
    });
    const shields = rows(values, mapped, 4, index => `Schild_Name_${index}`, {
        pa: index => `Schild_Mod_${index}`,
        weight: index => `Schild_Gewicht_${index}`,
        equipped: index => `Schild_Ver_${index}`,
    }).map(row => ({
        name: row.name,
        type: 'MELEE' as const,
        combatTechnique: 'Schilde',
        tp: '1w6',
        at: 0,
        pa: numberValue(row.pa),
        shieldPaBonus: numberValue(row.pa),
        weightGrams: Math.max(0, numberValue(row.weight) * 1_000),
        isEquipped: row.equipped ? true : undefined,
    }));
    const armor = rows(values, mapped, 4, index => `Ruestung_Name_${index}`, {
        rs: index => `Ruestung_RS_${index}`,
        be: index => `Ruestung_BE_${index}`,
        area: index => `Ruestung_Gebiet_${index}`,
        weight: index => `Ruestung_Gewicht_${index}`,
        equipped: index => `Ruestung_Ver_${index}`,
    }).map(row => ({
        name: row.name,
        armorRs: numberValue(row.rs),
        armorBe: numberValue(row.be),
        area: row.area || undefined,
        weightGrams: Math.max(0, numberValue(row.weight) * 1_000),
        isEquipped: row.equipped ? true : undefined,
    }));
    const zonedArmor = Array.from({ length: 4 }, (_, offset) => offset + 1)
        .map(index => {
            const nameField = `ZonenRuestung_Name_${index}`;
            mapped.add(nameField);
            const name = values.get(nameField)?.trim() ?? '';
            const zones = Object.fromEntries(
                [...values.entries()].filter(([field, value]) => {
                    const belongs = /^(ZoneRS_|ZonenRuestung_)/.test(field) && field.endsWith(`_${index}`);
                    if (belongs) mapped.add(field);
                    return belongs && Boolean(value);
                })
            );
            return { name, zones };
        })
        .filter(row => row.name || Object.keys(row.zones).length > 0)
        .map(row => ({ ...row, name: row.name || 'Zoned armor' }));
    stats.ruestungsschutz = Math.max(0, ...armor.map(row => row.armorRs));
    stats.belastung = Math.max(0, ...armor.map(row => row.armorBe));

    const specialAbilities = [
        ...rows(values, mapped, 46, index => `SF_Kampf_${index}`).map(row => ({ ...row, category: 'COMBAT' })),
        ...rows(values, mapped, 46, index => `SF_allg_${index}`).map(row => ({ ...row, category: 'GENERAL' })),
        ...rows(values, mapped, 46, index => `SF_mag_${index}`).map(row => ({ ...row, category: 'MAGICAL' })),
        ...rows(values, mapped, 46, index => `SF_karm_${index}`).map(row => ({ ...row, category: 'KARMAL' })),
    ];
    const spellRows = rows(values, mapped, 21, index => `Zauber_${index}`, { value: index => `Z_FW_${index}` });
    const liturgyRows = rows(values, mapped, 21, index => `Liturgie_${index}`, { value: index => `L_FW_${index}` });
    const combined = rows(values, mapped, 21, index => `ZauberLiturgie_${index}`, { value: index => `ZL_FW_${index}` });
    const advantages = rows(values, mapped, 22, index => `Vorteil_${index}`).map(row => row.name);
    const disadvantages = rows(values, mapped, 22, index => `Nachteil_${index}`).map(row => row.name);

    const usedNonEmpty = new Set([...mapped].filter(name => values.get(name)?.trim()));
    const unmappedNonEmpty = [...values.entries()]
        .filter(
            ([name, value]) =>
                value && !usedNonEmpty.has(name) && !/\.(FontSize|Option)$|_Anzeige_|Infowerte$/.test(name)
        )
        .map(([name]) => name)
        .sort();
    const character: CharacterImportResult = {
        source: 'DSA_PDF_1_93',
        profileId: DSA5_DOCUMENT_193_PROFILE.id,
        name: normalizeName(first(values, ['Held_Name'], mapped), 'character name'),
        stats,
        background: {
            culture: first(values, ['Held_Kultur', 'Held_Kultur_Anzeige'], mapped) || undefined,
            profession: first(values, ['Held_Profession', 'Held_Profession_Anzeige'], mapped) || undefined,
            species: first(values, ['Held_Spezies', 'Held_Spezies_Anzeige'], mapped) || undefined,
        },
        talents: talentRows,
        combatTechniques: techniques,
        weapons: [...meleeWeapons, ...rangedWeapons, ...shields],
        armor,
        zonedArmor,
        specialAbilities: specialAbilities.map(row => ({ name: row.name, category: row.category })),
        spells: spellRows.map(row => ({ name: row.name, value: numberValue(row.value) })),
        liturgies: liturgyRows.map(row => ({ name: row.name, value: numberValue(row.value) })),
        combinedSupernatural: combined.map(row => ({ name: row.name, value: numberValue(row.value) })),
        advantages,
        disadvantages,
        unresolvedFields: unmappedNonEmpty.slice(0, 200),
        unresolvedFieldCount: unmappedNonEmpty.length,
        warnings: [
            ...(signature === DSA5_DOCUMENT_193_PROFILE.inspectedSignature
                ? []
                : ['The sheet matches profile 1.93 sentinels but has a different structural signature.']),
            ...(unmappedNonEmpty.length
                ? [`${unmappedNonEmpty.length} non-empty fields are preserved as unresolved.`]
                : []),
        ],
    };
    ensureWithin(startedAt);
    return {
        profile: DSA5_DOCUMENT_193_PROFILE,
        inventory: { fieldCount: fields.length, widgetCount, duplicateWidgetFields, countsByType, signature },
        character,
    };
}
