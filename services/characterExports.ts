import { httpError } from '../db/operations/errors';
import { createCharacterExportFilename, formatCharacterSheetExport } from '../utils/characterSheetExport';
import { listLearnedSpecialAbilities } from './advancement';
import { getCharacterSheet } from './characters';
import { getWallet } from './economy';
import { listItems, listWeapons } from './inventory';
import { getSupernaturalProfile, listLearnedLiturgies, listLearnedSpells } from './supernatural';
import { listSkills } from './talents';
import type { Ctx } from './_ctx';

export async function exportCharacterSheet(ctx: Ctx) {
    const { player, stats } = await getCharacterSheet(ctx);
    if (!stats) throw httpError(404, 'Character stats not found');

    const [talents, weapons, items, specialAbilities, spells, liturgies, profile, wallet] = await Promise.all([
        listSkills(ctx),
        listWeapons(ctx),
        listItems(ctx),
        listLearnedSpecialAbilities(ctx),
        listLearnedSpells(ctx),
        listLearnedLiturgies(ctx),
        getSupernaturalProfile(ctx),
        getWallet(ctx),
    ]);
    const text = formatCharacterSheetExport({
        player,
        stats,
        talents,
        weapons,
        items,
        specialAbilities,
        spells,
        liturgies,
        profile,
        wallet,
    });
    return { characterName: player.name, filename: createCharacterExportFilename(player.name), text };
}
