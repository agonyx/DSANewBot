import { calculateWoundPenalty, calculateWoundThreshold, isIncapacitatedByWounds } from './woundUtils';

interface CharacterExportStats {
    mu: number;
    kl: number;
    in: number;
    ch: number;
    ff: number;
    ge: number;
    ko: number;
    kk: number;
    le_current: number;
    le_max: number;
    asp_current: number;
    asp_max: number;
    kap_current: number;
    kap_max: number;
    schicksalspunkte_current: number;
    schicksalspunkte_max: number;
    initiative: number;
    ausweichen: number;
    attacke_basis: number;
    parade_basis: number;
    ruestungsschutz: number;
    natural_armor: number;
    belastung: number;
    wounds: number;
    wound_threshold_modifier: number;
    ap_total: number;
    ap_available: number;
    ap_spent: number;
}

interface NamedAbility {
    name: string;
    category?: string | null;
}

export interface CharacterSheetExportInput {
    player: { name: string };
    stats: CharacterExportStats;
    talents: Array<{
        talent_name: string;
        category: string;
        stat1: string;
        stat2: string;
        stat3: string;
        ftw: number;
    }>;
    weapons: Array<{
        name: string;
        type: string | null;
        tp: string | null;
        at: number;
        pa: number;
        is_equipped: string;
        equipped_slot: string | null;
    }>;
    items: Array<{
        name: string;
        type: string;
        quantity: number;
        is_equipped: boolean;
        equipped_slot: string | null;
    }>;
    specialAbilities: {
        combatAbilities: NamedAbility[];
        catalogAbilities: NamedAbility[];
    };
    spells: Array<{ learned: { ftw: number }; spell: { name: string; kind: string } }>;
    liturgies: Array<{ learned: { ftw: number }; liturgy: { name: string; kind: string } }>;
    profile: {
        magicalTradition: string | null;
        blessedTradition: string | null;
        deity: string | null;
        favoredTalents: string[];
    };
    wallet: {
        balance: { dukaten: number; silbertaler: number; heller: number; kreuzer: number };
    };
    generatedAt?: Date;
}

const ATTRIBUTE_KEYS = ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk'] as const;

function sortByName<T>(rows: T[], name: (row: T) => string): T[] {
    return [...rows].sort((a, b) => name(a).localeCompare(name(b), 'de'));
}

function addSection(lines: string[], title: string, rows: string[]): void {
    lines.push('', title, '-'.repeat(title.length));
    lines.push(...(rows.length ? rows : ['None']));
}

export function createCharacterExportFilename(characterName: string): string {
    const stem = characterName
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${stem || 'character'}-character-sheet.txt`;
}

export function formatCharacterSheetExport(input: CharacterSheetExportInput): string {
    const { player, stats } = input;
    const generatedAt = input.generatedAt ?? new Date();
    const woundPenalty = calculateWoundPenalty(stats.wounds);
    const woundThreshold = calculateWoundThreshold(stats.ko, stats.wound_threshold_modifier);
    const lines = [
        'DSA5 CHARACTER SHEET',
        '====================',
        `Name: ${player.name}`,
        `Exported: ${generatedAt.toISOString()}`,
    ];

    addSection(
        lines,
        'Attributes',
        ATTRIBUTE_KEYS.map(key => {
            const value = stats[key];
            const effective = Math.max(0, value - woundPenalty);
            return `${key.toUpperCase()}: ${value}${woundPenalty ? ` (effective ${effective})` : ''}`;
        })
    );
    addSection(lines, 'Resources', [
        `LP: ${stats.le_current}/${stats.le_max}`,
        `AsP: ${stats.asp_current}/${stats.asp_max}`,
        `KaP: ${stats.kap_current}/${stats.kap_max}`,
        `Fate Points: ${stats.schicksalspunkte_current}/${stats.schicksalspunkte_max}`,
        `AP: ${stats.ap_available} available / ${stats.ap_spent} spent / ${stats.ap_total} total`,
    ]);
    addSection(lines, 'Combat', [
        `Initiative: ${stats.initiative}`,
        `Dodge: ${stats.ausweichen}`,
        `Base AT/PA: ${stats.attacke_basis}/${stats.parade_basis}`,
        `Armor: ${stats.ruestungsschutz} RS (${stats.natural_armor} natural), ${stats.belastung} Belastung`,
        `Wounds: ${stats.wounds} (threshold ${woundThreshold || '—'}, penalty -${woundPenalty})`,
        `Capable: ${isIncapacitatedByWounds(stats.wounds) ? 'No' : 'Yes'}`,
    ]);
    addSection(
        lines,
        'Talents',
        sortByName(input.talents, row => row.talent_name).map(
            row => `${row.talent_name} [${row.category}] ${row.stat1}/${row.stat2}/${row.stat3} FW ${row.ftw}`
        )
    );
    addSection(
        lines,
        'Weapons',
        sortByName(input.weapons, row => row.name).map(row => {
            const equipped = row.is_equipped === 'Y' ? `, equipped ${row.equipped_slot || ''}`.trimEnd() : '';
            return `${row.name} [${row.type || 'UNKNOWN'}] TP ${row.tp || '—'}, AT ${row.at}, PA ${row.pa}${equipped}`;
        })
    );
    addSection(
        lines,
        'Items',
        sortByName(input.items, row => row.name).map(
            row =>
                `${row.name} x${row.quantity} [${row.type}]${
                    row.is_equipped ? `, equipped ${row.equipped_slot || ''}`.trimEnd() : ''
                }`
        )
    );
    addSection(
        lines,
        'Special Abilities',
        sortByName(
            [...input.specialAbilities.combatAbilities, ...input.specialAbilities.catalogAbilities],
            row => row.name
        ).map(row => `${row.name}${row.category ? ` [${row.category}]` : ''}`)
    );
    addSection(lines, 'Traditions', [
        `Magical: ${input.profile.magicalTradition || 'None'}`,
        `Blessed: ${input.profile.blessedTradition || 'None'}`,
        `Deity: ${input.profile.deity || 'None'}`,
        `Favored talents: ${input.profile.favoredTalents.join(', ') || 'None'}`,
    ]);
    addSection(
        lines,
        'Spells & Rituals',
        sortByName(input.spells, row => row.spell.name).map(
            row => `${row.spell.name} [${row.spell.kind}] FW ${row.learned.ftw}`
        )
    );
    addSection(
        lines,
        'Liturgies & Ceremonies',
        sortByName(input.liturgies, row => row.liturgy.name).map(
            row => `${row.liturgy.name} [${row.liturgy.kind}] FW ${row.learned.ftw}`
        )
    );
    const balance = input.wallet.balance;
    addSection(lines, 'Wallet', [
        `${balance.dukaten} D / ${balance.silbertaler} S / ${balance.heller} H / ${balance.kreuzer} K`,
    ]);

    return `${lines.join('\n')}\n`;
}
