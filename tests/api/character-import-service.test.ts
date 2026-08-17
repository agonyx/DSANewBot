import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, like } from 'drizzle-orm';
import { closeDb, db } from '../../db';
import {
    actionModifications,
    characterRecords,
    items,
    liturgies,
    playerActionModifications,
    playerLiturgies,
    players,
    playerSpecialAbilities,
    playerSpells,
    playerTalents,
    specialAbilities,
    spells,
    stats,
    talents,
    weapons,
} from '../../db/schema';
import { importNormalizedCharacter } from '../../services/characterRecords';
import { parseDsaCharacterPdf } from '../../utils/characterPdfImport';
import { createDsaCharacterPdf193Fixture } from '../fixtures/dsaCharacterPdf193';

const TEST_DISCORD_ID = `test-pdf-import-${Date.now()}`;
const ROLLBACK_DISCORD_ID = `${TEST_DISCORD_ID}-rollback`;
const EXTERNAL_PREFIX = `${TEST_DISCORD_ID}-catalog`;
const MANEUVER_NAME = `Finte I ${TEST_DISCORD_ID}`;
const TALENT_NAME = `Body Control ${TEST_DISCORD_ID}`;
const GENERAL_ABILITY_NAME = `General ability ${TEST_DISCORD_ID}`;
const MAGICAL_ABILITY_NAME = `Magical ability ${TEST_DISCORD_ID}`;
const KARMAL_ABILITY_NAME = `Karmal ability ${TEST_DISCORD_ID}`;
const SPELL_NAME = `Spell ${TEST_DISCORD_ID}`;
const LITURGY_NAME = `Liturgy ${TEST_DISCORD_ID}`;
const COMBINED_NAME = `Blessing ${TEST_DISCORD_ID}`;

async function cleanup() {
    await db.delete(players).where(inArray(players.discord_id, [TEST_DISCORD_ID, ROLLBACK_DISCORD_ID]));
    await db.delete(actionModifications).where(eq(actionModifications.name, MANEUVER_NAME));
    await db.delete(talents).where(eq(talents.name, TALENT_NAME));
    await db.delete(specialAbilities).where(like(specialAbilities.external_id, `${EXTERNAL_PREFIX}-%`));
    await db.delete(spells).where(like(spells.external_id, `${EXTERNAL_PREFIX}-%`));
    await db.delete(liturgies).where(like(liturgies.external_id, `${EXTERNAL_PREFIX}-%`));
}

describe('character PDF import service (live DB)', () => {
    before(async () => {
        await cleanup();
        await db.insert(talents).values({
            name: TALENT_NAME,
            stat1: 'GE',
            stat2: 'GE',
            stat3: 'KO',
            category: 'PHYSICAL',
        });
        await db.insert(actionModifications).values({
            name: MANEUVER_NAME,
            action_type: 'MELEE',
            rules: { type: 'feint', at_modifier: -1, opponent_pa_modifier: -2 },
        });
        await db.insert(specialAbilities).values(
            [GENERAL_ABILITY_NAME, MAGICAL_ABILITY_NAME, KARMAL_ABILITY_NAME].map((name, index) => ({
                external_id: `${EXTERNAL_PREFIX}-special-${index}`,
                name,
                category: index === 2 ? 'KARMAL' : 'MAGICAL',
                ap_cost: 1,
            }))
        );
        await db.insert(spells).values({
            external_id: `${EXTERNAL_PREFIX}-spell`,
            name: SPELL_NAME,
            kind: 'SPELL',
        });
        await db.insert(liturgies).values([
            {
                external_id: `${EXTERNAL_PREFIX}-liturgy`,
                name: LITURGY_NAME,
                kind: 'LITURGY',
            },
            {
                external_id: `${EXTERNAL_PREFIX}-combined`,
                name: COMBINED_NAME,
                kind: 'BLESSING',
            },
        ]);
    });

    after(async () => {
        await cleanup();
        await closeDb();
    });

    it('imports all six mapped slices in one transaction and preserves unresolved data', async () => {
        const parsed = (await parseDsaCharacterPdf(await createDsaCharacterPdf193Fixture())).character;
        parsed.talents = parsed.talents?.map(row => ({ ...row, name: TALENT_NAME }));
        parsed.specialAbilities = parsed.specialAbilities?.map(row =>
            row.category === 'COMBAT'
                ? { ...row, name: MANEUVER_NAME }
                : row.category === 'GENERAL'
                  ? { ...row, name: GENERAL_ABILITY_NAME }
                  : row.category === 'MAGICAL'
                    ? { ...row, name: MAGICAL_ABILITY_NAME }
                    : { ...row, name: KARMAL_ABILITY_NAME }
        );
        parsed.spells = parsed.spells?.map(row => ({ ...row, name: SPELL_NAME }));
        parsed.liturgies = parsed.liturgies?.map(row => ({ ...row, name: LITURGY_NAME }));
        parsed.combinedSupernatural = parsed.combinedSupernatural?.map(row => ({ ...row, name: COMBINED_NAME }));
        const result = await importNormalizedCharacter({ discordId: TEST_DISCORD_ID }, parsed);
        const playerId = result.player.id;

        const [statRow] = await db.select().from(stats).where(eq(stats.player_id, playerId));
        assert.equal(statRow.mu, 14);
        assert.equal(statRow.seelenkraft, 3);
        assert.equal(statRow.zaehigkeit, 2);
        assert.equal(statRow.ap_available, 100);

        const talentRows = await db
            .select({ name: talents.name, value: playerTalents.ftw })
            .from(playerTalents)
            .innerJoin(talents, eq(playerTalents.talent_id, talents.id))
            .where(eq(playerTalents.player_id, playerId));
        assert.ok(talentRows.some(row => row.name === TALENT_NAME && row.value === 8));

        const importedWeapons = await db.select().from(weapons).where(eq(weapons.player_id, playerId));
        assert.equal(importedWeapons.length, 3);
        assert.equal(importedWeapons.find(row => row.name === 'Longsword')?.equipped_slot, 'OFFENSE');
        assert.equal(importedWeapons.find(row => row.name === 'Wooden shield')?.equipped_slot, 'DEFENSE');
        assert.equal((await db.select().from(items).where(eq(items.player_id, playerId)))[0].armor_rs, 3);

        assert.equal(
            (await db.select().from(playerActionModifications).where(eq(playerActionModifications.player_id, playerId)))
                .length,
            1
        );
        assert.equal(
            (await db.select().from(playerSpecialAbilities).where(eq(playerSpecialAbilities.player_id, playerId)))
                .length,
            3
        );
        assert.equal((await db.select().from(playerSpells).where(eq(playerSpells.player_id, playerId)))[0].ftw, 10);
        assert.deepEqual(
            (await db.select().from(playerLiturgies).where(eq(playerLiturgies.player_id, playerId)))
                .map(row => row.ftw)
                .sort((a, b) => a - b),
            [7, 8]
        );

        const records = await db.select().from(characterRecords).where(eq(characterRecords.player_id, playerId));
        for (const kind of [
            'BACKGROUND',
            'COMBAT_TECHNIQUE',
            'ZONED_ARMOR',
            'ADVANTAGE',
            'DISADVANTAGE',
            'SPECIAL_ABILITY',
            'IMPORT_UNRESOLVED',
        ]) {
            assert.ok(
                records.some(row => row.kind === kind),
                `expected ${kind} record`
            );
        }
        const unresolved = records.find(row => row.kind === 'IMPORT_UNRESOLVED');
        assert.ok(Number(unresolved?.data.fieldCount) > 0);
        assert.equal(result.preview.mappedCounts.weapons, 3);
        assert.equal(result.preview.catalogMatches.combinedLiturgies.exact, 1);
    });

    it('rolls the whole import back when a late relation insert fails', async () => {
        const parsed = (await parseDsaCharacterPdf(await createDsaCharacterPdf193Fixture())).character;
        parsed.name = 'Rollback Hero';
        parsed.advantages = ['Duplicate advantage', 'Duplicate advantage'];
        await assert.rejects(() => importNormalizedCharacter({ discordId: ROLLBACK_DISCORD_ID }, parsed));
        assert.equal(
            (
                await db
                    .select({ id: players.id })
                    .from(players)
                    .where(and(eq(players.discord_id, ROLLBACK_DISCORD_ID), eq(players.name, 'Rollback Hero')))
            ).length,
            0
        );
    });
});
