const { formatCurrency } = require('./economyUtils');
const { calculatePainLevel } = require('./conditionUtils');
const {
    calculateEffectivePainLevel,
    calculateWoundPenalty,
    calculateWoundThreshold,
    isIncapacitatedByWounds,
} = require('./woundUtils');
const {
    buildListEmbeds,
    buildSectionEmbeds,
    createEmbed,
    formatStructuredLines,
    makeFooter,
    progressBar,
    truncateText,
} = require('./embedUtils');

const ITEM_TYPES = Object.freeze([
    ['WEAPON', '⚔️ Weapons'],
    ['ARMOR', '🛡️ Armor'],
    ['CLOTHING', '👕 Clothing'],
    ['POTION', '🧪 Potions'],
    ['FOOD', '🍖 Food'],
    ['SCROLL', '📜 Scrolls'],
    ['CONSUMABLE', '🧰 Consumables'],
    ['GEAR', '🎒 Gear'],
    ['VALUABLE', '💎 Valuables'],
    ['MISC', '📦 Miscellaneous'],
]);

function formatWeight(grams) {
    const kilograms = Math.max(0, Number(grams) || 0) / 1000;
    return `${kilograms.toFixed(kilograms >= 10 ? 0 : 1)} Stein`;
}

function buildInventoryEmbeds(player, items, user) {
    const stackCount = items.length;
    const unitCount = items.reduce((total, item) => total + Math.max(1, Number(item.quantity) || 1), 0);
    const totalWeight = items.reduce(
        (total, item) => total + Math.max(0, Number(item.weight_grams) || 0) * Math.max(1, Number(item.quantity) || 1),
        0
    );
    const grouped = new Map();

    for (const item of items) {
        const type = item.type || 'MISC';
        if (!grouped.has(type)) grouped.set(type, []);
        const quantity = Math.max(1, Number(item.quantity) || 1);
        const equipment = item.is_equipped
            ? ` · **Equipped:** ${item.equipped_slot || 'unslotted'}${item.armor_rs ? ` · RS ${item.armor_rs}` : ''}${item.armor_be ? ` · BE ${item.armor_be}` : ''}`
            : '';
        const detail = item.effect || item.description;
        grouped
            .get(type)
            .push(
                `**#${item.id} · ${item.name}**${quantity > 1 ? ` ×${quantity}` : ''}\n` +
                    `${formatWeight((Number(item.weight_grams) || 0) * quantity)} · ${formatCurrency(item.price_kreuzer)}${equipment}` +
                    (detail ? `\n↳ ${truncateText(detail, 180)}` : '')
            );
    }

    const knownTypes = new Set(ITEM_TYPES.map(([type]) => type));
    const sections = ITEM_TYPES.filter(([type]) => grouped.has(type)).map(([type, label]) => ({
        name: label,
        lines: grouped.get(type),
    }));
    for (const [type, typeItems] of grouped) {
        if (!knownTypes.has(type)) sections.push({ name: `📦 ${type}`, lines: typeItems });
    }

    return buildSectionEmbeds({
        title: `🎒 ${player.name} — Inventory`,
        description: `**${stackCount} stacks · ${unitCount} units · ${formatWeight(totalWeight)} carried**\nUse the numeric ID with inventory, equipment, shop, and trade commands.`,
        sections,
        theme: 'inventory',
        footer: makeFooter(user),
    });
}

function weaponLine(weapon) {
    const equipped = weapon.is_equipped === 'Y' ? ` · **${weapon.equipped_slot || 'equipped'}**` : '';
    const hands = weapon.is_two_handed ? '2H' : '1H';
    const valueAndWeight = `${formatWeight(weapon.weight_grams)} · ${formatCurrency(weapon.price_kreuzer)}`;

    if (weapon.type === 'RANGED') {
        return (
            `**#${weapon.id} · ${weapon.name}**${equipped}\n` +
            `${weapon.combat_technique || 'No technique'} · ${weapon.tp} TP · AT ${weapon.at} · ${hands}\n` +
            `Range ${weapon.range_close ?? 10}/${weapon.range_medium ?? 50}/${weapon.range_far ?? 100} · Reload ${weapon.reload_actions ?? 0} · ${valueAndWeight}`
        );
    }

    return (
        `**#${weapon.id} · ${weapon.name}**${equipped}\n` +
        `${weapon.combat_technique || 'No technique'} · ${weapon.tp} TP · AT ${weapon.at} · PA ${weapon.pa}${weapon.shield_pa_bonus ? ` (+${weapon.shield_pa_bonus} shield)` : ''} · ${hands}\n` +
        valueAndWeight
    );
}

function buildWeaponEmbeds(player, weapons, user) {
    const melee = weapons.filter(weapon => weapon.type === 'MELEE');
    const ranged = weapons.filter(weapon => weapon.type === 'RANGED');
    const other = weapons.filter(weapon => weapon.type !== 'MELEE' && weapon.type !== 'RANGED');
    const sections = [
        ...(melee.length ? [{ name: '⚔️ Melee', lines: melee.map(weaponLine) }] : []),
        ...(ranged.length ? [{ name: '🏹 Ranged', lines: ranged.map(weaponLine) }] : []),
        ...(other.length ? [{ name: '🗡️ Other', lines: other.map(weaponLine) }] : []),
    ];

    return buildSectionEmbeds({
        title: `🗡️ ${player.name} — Weapons`,
        description: `**${weapons.length} weapon${weapons.length === 1 ? '' : 's'}** · IDs work with weapon, shop, equipment, and trade commands.`,
        sections,
        theme: 'combat',
        footer: makeFooter(user),
    });
}

function buildCharacterStatsEmbed(player, stats, user) {
    const maximumLife = Math.max(1, stats.le_max || 1);
    const currentLife = stats.le_current || 0;
    const woundThreshold = calculateWoundThreshold(stats.ko, stats.wound_threshold_modifier);
    const woundPenalty = calculateWoundPenalty(stats.wounds);
    const painLevel = calculateEffectivePainLevel(
        calculatePainLevel(currentLife, maximumLife),
        stats.pain_suppression,
        stats.pain_modifier
    );
    const capable = !isIncapacitatedByWounds(stats.wounds);
    const resources = [
        `❤️ **LeP** ${progressBar(currentLife, maximumLife)} ${currentLife}/${maximumLife}`,
        `🎲 **SchP** ${progressBar(stats.schicksalspunkte_current, stats.schicksalspunkte_max, 5)} ${stats.schicksalspunkte_current}/${stats.schicksalspunkte_max}`,
        `⭐ **AP** ${stats.ap_available} available · ${stats.ap_spent} spent · ${stats.ap_total} total`,
    ];
    if (stats.asp_max > 0) {
        resources.push(
            `✨ **AsP** ${progressBar(stats.asp_current, stats.asp_max)} ${stats.asp_current}/${stats.asp_max}`
        );
    }
    if (stats.kap_max > 0) {
        resources.push(
            `🙏 **KaP** ${progressBar(stats.kap_current, stats.kap_max)} ${stats.kap_current}/${stats.kap_max}`
        );
    }

    return createEmbed(capable ? 'character' : 'danger')
        .setTitle(`🔰 ${player.name} — Character Sheet`)
        .setDescription(capable ? 'Ready for adventure.' : '**Incapacitated by wounds.**')
        .addFields(
            {
                name: '🧠 Attributes',
                value: `**MU** ${stats.mu} · **KL** ${stats.kl} · **IN** ${stats.in} · **CH** ${stats.ch}`,
                inline: false,
            },
            {
                name: '🏃 Physical Attributes',
                value: `**FF** ${stats.ff} · **GE** ${stats.ge} · **KO** ${stats.ko} · **KK** ${stats.kk}`,
                inline: false,
            },
            {
                name: '🩸 Vitals & Wounds',
                value: [
                    `LeP ${currentLife}/${maximumLife} · Pain ${painLevel}`,
                    `Wounds ${stats.wounds} · Threshold ${woundThreshold || '—'} · Penalty -${woundPenalty}`,
                ].join('\n'),
                inline: true,
            },
            {
                name: '🛡️ Combat & Protection',
                value: [
                    `INI ${stats.initiative} · Dodge ${stats.ausweichen}`,
                    `RS ${stats.ruestungsschutz} (natural ${stats.natural_armor}) · BE ${stats.belastung}`,
                ].join('\n'),
                inline: true,
            },
            { name: '📊 Resources', value: resources.join('\n'), inline: false }
        )
        .setFooter(makeFooter(user));
}

function buildManeuverDetailEmbed(maneuver) {
    return createEmbed('combat')
        .setTitle(`⚔️ ${maneuver.name}`)
        .setDescription(truncateText(maneuver.description || 'No description.', 3500))
        .addFields(
            { name: 'Type', value: maneuver.action_type || 'Passive', inline: true },
            {
                name: 'Prerequisites',
                value: truncateText(formatStructuredLines(maneuver.prerequisites).join('\n'), 1024),
            },
            { name: 'Rules', value: truncateText(formatStructuredLines(maneuver.rules).join('\n'), 1024) }
        );
}

function buildManeuverListEmbeds(maneuvers) {
    return buildListEmbeds({
        title: '⚔️ Combat Maneuvers',
        theme: 'combat',
        description: `**${maneuvers.length} result${maneuvers.length === 1 ? '' : 's'}**`,
        lines: maneuvers.map(
            maneuver =>
                `**${maneuver.name}** · ${maneuver.action_type || 'Passive'}\n${truncateText(maneuver.description, 220, 'No description.')}`
        ),
        emptyMessage: 'No maneuvers found.',
    });
}

function buildMobListEmbeds(mobs) {
    return buildListEmbeds({
        title: '👾 Mob Templates',
        theme: 'combat',
        description: `**${mobs.length} template${mobs.length === 1 ? '' : 's'} available**`,
        lines: mobs.map(
            mob =>
                `**${mob.name}** · LP ${mob.base_max_hp ?? '—'} · INI ${mob.base_initiative ?? '—'} · AT ${mob.base_attack_value ?? '—'} · PA ${mob.base_parry_value ?? '—'} · RS ${mob.base_armor_soak ?? '—'} · TP ${mob.base_damage_tp ?? '—'}` +
                (mob.description ? `\n${truncateText(mob.description, 180)}` : '')
        ),
        timestamp: true,
    });
}

function buildAbilityListEmbeds(result) {
    const rows = [...result.combatAbilities, ...result.catalogAbilities];
    return buildListEmbeds({
        title: `📋 ${result.characterName} — Special Abilities`,
        theme: 'character',
        description: `**${rows.length} learned abilit${rows.length === 1 ? 'y' : 'ies'}**`,
        lines: rows.map(
            ability =>
                `**${ability.name}** · ${ability.category || 'Special'} · ${ability.apCost} AP\n${truncateText(ability.description, 220, 'No description.')}`
        ),
        emptyMessage: 'This character has not learned any special abilities yet.',
    });
}

function buildPartyOverviewEmbeds(party, user) {
    return buildListEmbeds({
        title: '🧭 Party Overview',
        theme: 'character',
        description: `**${party.length} enrolled character${party.length === 1 ? '' : 's'}**`,
        lines: party.map(character => {
            const resources = [
                `LeP ${character.leCurrent ?? 0}/${character.leMax ?? 0}`,
                `INI ${character.initiative ?? 0}`,
                `Wounds ${character.wounds ?? 0}`,
            ];
            if ((character.aspMax ?? 0) > 0) resources.push(`AsP ${character.aspCurrent ?? 0}/${character.aspMax}`);
            if ((character.kapMax ?? 0) > 0) resources.push(`KaP ${character.kapCurrent ?? 0}/${character.kapMax}`);
            if ((character.fateMax ?? 0) > 0) resources.push(`Fate ${character.fateCurrent ?? 0}/${character.fateMax}`);
            return `<@${character.discordId}> — **${character.name}**\n${resources.join(' · ')}`;
        }),
        emptyMessage:
            'No characters have joined this server party. Players can use `/party join` after selecting a character.',
        footer: makeFooter(user),
        timestamp: true,
    });
}

function buildInitiativeTrackerEmbeds(tracker, user) {
    const entries = Array.isArray(tracker.entries) ? tracker.entries : [];
    return buildListEmbeds({
        title: `⏱️ ${tracker.title}`,
        theme: 'combat',
        description: entries.length
            ? `**Round ${Math.max(1, tracker.current_round || 1)}** · ${entries.length} participant${entries.length === 1 ? '' : 's'}`
            : '**Ready for participants**',
        lines: entries.map((entry, index) => {
            const marker = index === tracker.current_entry_index ? '▶' : '•';
            const detail = entry.roll == null ? 'manual' : `INI ${entry.baseInitiative} + 1W6 (${entry.roll})`;
            return `${marker} **${index + 1}. ${entry.name}** — **${entry.total}** · ${detail}`;
        }),
        emptyMessage: 'No entries yet. Use `/initiative add` to add a participant.',
        footer: makeFooter(user, 'Managed by'),
        timestamp: true,
    });
}

function buildSessionNoteEmbed(note, user) {
    const embed = createEmbed('info')
        .setTitle(`📝 ${truncateText(note.title, 250)}`)
        .setDescription(truncateText(note.body, 4000))
        .addFields(
            { name: 'Session date', value: note.session_date || 'Not specified', inline: true },
            {
                name: 'Last updated',
                value: `<t:${Math.floor(new Date(note.updated_at).getTime() / 1000)}:R>`,
                inline: true,
            }
        )
        .setFooter(makeFooter(user, 'Viewed by'));
    return embed;
}

function buildSessionNoteListEmbeds(notes, user) {
    return buildListEmbeds({
        title: '📝 Session Notes',
        theme: 'info',
        description: `**${notes.length} saved note${notes.length === 1 ? '' : 's'}**`,
        lines: notes.map(note => {
            const date = note.session_date || new Date(note.created_at).toISOString().slice(0, 10);
            return `**${note.title}** · ${date}\n${truncateText(note.body, 180)}`;
        }),
        emptyMessage: 'No session notes yet. Use `/session-notes add` to create one.',
        footer: makeFooter(user),
        timestamp: true,
    });
}

module.exports = {
    buildAbilityListEmbeds,
    buildCharacterStatsEmbed,
    buildInventoryEmbeds,
    buildInitiativeTrackerEmbeds,
    buildManeuverDetailEmbed,
    buildManeuverListEmbeds,
    buildMobListEmbeds,
    buildPartyOverviewEmbeds,
    buildSessionNoteEmbed,
    buildSessionNoteListEmbeds,
    buildWeaponEmbeds,
    formatWeight,
};
