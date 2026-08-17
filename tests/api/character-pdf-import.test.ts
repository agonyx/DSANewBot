import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DSA5_DOCUMENT_193_PROFILE, parseDsaCharacterPdf } from '../../utils/characterPdfImport';
import { createDsaCharacterPdf193Fixture as fixture } from '../fixtures/dsaCharacterPdf193';

describe('DSA5-Dokument V1.93 PDF profile', () => {
    it('parses AcroForm values, choices, checkboxes, and duplicate widgets without OCR', async () => {
        const result = await parseDsaCharacterPdf(await fixture(), { mimeType: 'application/pdf' });
        assert.equal(result.profile.id, DSA5_DOCUMENT_193_PROFILE.id);
        assert.equal(result.character.name, 'Generated Hero');
        assert.equal(result.character.stats.mu, 14);
        assert.equal(result.character.stats.le_current, 27);
        assert.equal(result.character.stats.ap_available, 100);
        assert.equal(result.character.stats.seelenkraft, 3);
        assert.deepEqual(result.character.background, {
            culture: 'Test culture',
            profession: 'Test profession',
            species: 'Human',
        });
        assert.deepEqual(result.character.talents?.[0], {
            name: 'Körperbeherrschung',
            value: 8,
            notes: 'Acrobatics focus',
        });
        assert.deepEqual(result.character.combatTechniques?.[0], { name: 'Schwerter', at: 15, pa: 9, value: 0 });
        assert.equal(result.character.weapons?.length, 3);
        assert.deepEqual(result.character.weapons?.[1].rangeMedium, 50);
        assert.equal(result.character.weapons?.[2].shieldPaBonus, 2);
        assert.equal(result.character.armor?.[0].armorBe, 1);
        assert.equal(result.character.zonedArmor?.[0].zones.ZoneRS_Kopf_1, '2');
        assert.deepEqual(
            result.character.specialAbilities?.map(row => row.category),
            ['COMBAT', 'GENERAL', 'MAGICAL', 'KARMAL']
        );
        assert.deepEqual(result.character.spells?.[0], { name: 'Ignifaxius', value: 10 });
        assert.deepEqual(result.character.liturgies?.[0], { name: 'Heilungssegen', value: 8 });
        assert.deepEqual(result.character.combinedSupernatural?.[0], { name: 'Custom blessing', value: 7 });
        assert.deepEqual(result.character.advantages, ['Beidhändig']);
        assert.deepEqual(result.character.disadvantages, ['Aberglaube']);
        assert.ok(result.inventory.duplicateWidgetFields >= 1);
        assert.equal(result.inventory.countsByType.DROPDOWN, 1);
        assert.equal(result.inventory.countsByType.CHECKBOX, 1);
        assert.ok(result.character.unresolvedFields?.includes('Custom.Choice'));
        assert.ok(result.character.unresolvedFields?.includes('Custom.Checked'));
    });

    it('reports the structural fingerprint for unsupported variants', async () => {
        const unsupported = await fixture({ title: 'Different sheet', pages: 11 });
        await assert.rejects(
            () => parseDsaCharacterPdf(unsupported),
            /Unsupported character PDF.*pages=11.*signature=/
        );
    });

    it('enforces magic, MIME, malformed-data, page, and byte limits', async () => {
        const valid = await fixture();
        const tooManyPages = await fixture({ pages: 21 });
        await assert.rejects(() => parseDsaCharacterPdf(new TextEncoder().encode('not pdf')), /not a PDF/);
        await assert.rejects(() => parseDsaCharacterPdf(valid, { mimeType: 'image/png' }), /Unsupported PDF MIME/);
        await assert.rejects(() => parseDsaCharacterPdf(tooManyPages), /maximum is 20/);
        const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
        oversized.set(new TextEncoder().encode('%PDF-'));
        await assert.rejects(() => parseDsaCharacterPdf(oversized), /at most/);
    });
});
