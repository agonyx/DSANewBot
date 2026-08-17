const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ThumbnailBuilder,
} = require('discord.js');
const { formatStructuredLines } = require('./embedUtils');

const COLORS = {
    combat: 0xc92a2a,
    magic: 0x6f42c1,
    karma: 0xd4a017,
    character: 0x2f6f8f,
};

function text(content) {
    return new TextDisplayBuilder().setContent(String(content).slice(0, 4000));
}

function separator() {
    return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function componentPayload(container, { ephemeral = false } = {}) {
    return {
        flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        components: [container],
    };
}

function addActionRows(container, actionRows = []) {
    for (const row of actionRows.filter(Boolean).slice(0, 5)) container.addActionRowComponents(row);
}

function participantLine(combatant) {
    const type = combatant.type === 'NPC' ? 'NPC' : 'Hero';
    return `• **${String(combatant.name || 'Unknown').slice(0, 80)}** · ${type} · ${healthLine(combatant)}`;
}

function buildCombatSetupComponentPayload(sessionId, dmUsername, combatants = [], canStart = false, options = {}) {
    const heroes = combatants.filter(row => row.allegiance === 'PLAYER_SIDE').map(participantLine);
    const hostiles = combatants.filter(row => row.allegiance === 'HOSTILE').map(participantLine);
    const container = new ContainerBuilder().setAccentColor(canStart ? 0x2b8a3e : COLORS.combat);
    container.addTextDisplayComponents(
        text('# ⚔️ Combat setup'),
        text(
            `**Game master:** ${String(dmUsername || 'Unknown').slice(0, 80)}\n` +
                `**Status:** ${canStart ? '✅ Ready to begin' : '⏳ Add at least one hero and one hostile'}`
        ),
        text(
            `### Heroes\n${heroes.join('\n') || 'No heroes have joined.'}\n\n### Hostiles\n${hostiles.join('\n') || 'No hostiles added.'}`
        )
    );
    addActionRows(container, options.actionRows);
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(`-# Session ${String(sessionId || '').slice(0, 8)}`));
    return componentPayload(container, options);
}

function healthLine(combatant) {
    const current = Math.max(0, Number(combatant.currentHP ?? combatant.current_hp ?? 0));
    const max = Math.max(1, Number(combatant.maxHP ?? combatant.max_hp ?? 1));
    const filled = Math.max(0, Math.min(8, Math.round((current / max) * 8)));
    return `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)} ${current}/${max}`;
}

function buildCombatComponentPayload(session, pending = null, options = {}) {
    const combatants = session.combatants || [];
    const order = session.turnOrder || session.turn_order || [];
    const index = session.currentTurnIndex ?? session.current_turn_index ?? 0;
    const active = combatants.find(row => row.id === order[index]);
    const container = new ContainerBuilder().setAccentColor(COLORS.combat);
    container.addTextDisplayComponents(
        text(
            `# ⚔️ Combat · Round ${session.currentRound ?? session.current_round ?? 1}` +
                (session.state === 'PAUSED' ? ' · Paused' : session.state === 'ENDED' ? ' · Ended' : '')
        ),
        text(active ? `## ${active.name}'s turn\n${healthLine(active)}` : 'Waiting for the next combatant…')
    );
    if (pending) {
        container.addSeparatorComponents(separator());
        container.addTextDisplayComponents(
            text(
                `### 🛡️ Defense required\n**${pending.attackerName}** rolled **${pending.attack.roll}/${pending.atValue}** against **${pending.targetName}**.`
            )
        );
        if (!options.actionRows?.length) {
            const buttons = (pending.defenseOptions || [])
                .filter(option => option.available && option.choice !== 'DECLINE')
                .map(option =>
                    new ButtonBuilder()
                        .setCustomId(`cad_${pending.id}_${option.choice}`)
                        .setLabel(`${option.choice === 'PARRY' ? 'Parry' : 'Dodge'} (${option.effectiveValue})`)
                        .setStyle(option.choice === 'PARRY' ? ButtonStyle.Primary : ButtonStyle.Success)
                );
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`cad_${pending.id}_DECLINE`)
                    .setLabel('Take Hit')
                    .setStyle(ButtonStyle.Danger)
            );
            container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
        }
    }
    container.addSeparatorComponents(separator());
    const heroes = combatants
        .filter(row => row.allegiance === 'PLAYER_SIDE')
        .map(row => `• **${row.name}** · ${healthLine(row)}`);
    const hostiles = combatants
        .filter(row => row.allegiance === 'HOSTILE')
        .map(row => `• **${row.name}** · ${healthLine(row)}`);
    container.addTextDisplayComponents(
        text(`### Heroes\n${heroes.join('\n') || 'None'}\n\n### Hostiles\n${hostiles.join('\n') || 'None'}`)
    );
    if (options.unavailable) {
        container.addSeparatorComponents(separator());
        container.addTextDisplayComponents(
            text(`### Unavailable right now\n${String(options.unavailable).slice(0, 1800)}`)
        );
    }
    const recentLogs = (options.recentLogs || []).slice(-4).map(line => `• ${String(line).slice(0, 300)}`);
    if (recentLogs.length) {
        container.addSeparatorComponents(separator());
        container.addTextDisplayComponents(text(`### Recent events\n${recentLogs.join('\n')}`));
    }
    addActionRows(container, options.actionRows);
    return componentPayload(container, options);
}

function buildAbilityComponentPayload(ability, result = null, options = {}) {
    const abilityType = ability.abilityType || ability.ability_type || 'SPELL';
    const resource = ability.resourceLabel || (abilityType === 'LITURGY' ? 'KaP' : 'AsP');
    const probe =
        ability.probe ||
        [ability.probe_attr1, ability.probe_attr2, ability.probe_attr3].filter(Boolean).join('/') ||
        'Automatic';
    const resourceCost = ability.resourceCost ?? ability.resource_cost ?? 0;
    const castingTime = ability.castingTime || ability.casting_time || 'Immediate';
    const container = new ContainerBuilder().setAccentColor(abilityType === 'LITURGY' ? COLORS.karma : COLORS.magic);
    container.addTextDisplayComponents(
        text(`# ${abilityType === 'LITURGY' ? '🙏' : '✨'} ${ability.name}`),
        text(ability.description || 'No description.'),
        text(
            `**Kind** ${ability.kind || abilityType}  ·  **Probe** ${probe}  ·  **Cost** ${resourceCost} ${resource}\n` +
                `**Casting** ${castingTime}  ·  **Range** ${ability.range || 'Unspecified'}  ·  **Duration** ${ability.duration || 'Immediate'}`
        )
    );
    if (result) {
        container.addSeparatorComponents(separator());
        container.addTextDisplayComponents(
            text(
                `## ${result.success ? '✅ Success' : '❌ Failed'}\n` +
                    `QS **${result.qualityLevel ?? 0}** · Paid **${result.paidCost ?? 0} ${resource}**` +
                    (result.resourceAfter === undefined ? '' : ` · **${result.resourceAfter}** remain`) +
                    (result.statusText ? `\n${result.statusText}` : '')
            )
        );
    }
    return componentPayload(container, options);
}

function buildCharacterComponentPayload(sheet, options = {}) {
    const player = sheet.player || sheet;
    const stats = sheet.stats || {};
    const attrs = ['mu', 'kl', 'in', 'ch', 'ff', 'ge', 'ko', 'kk']
        .map(key => `**${key.toUpperCase()}** ${stats[key] ?? 0}`)
        .join('  ·  ');
    const container = new ContainerBuilder().setAccentColor(COLORS.character);
    const heading = text(`# 👤 ${player.name || 'Character'}`);
    if (options.avatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(heading)
                .setThumbnailAccessory(
                    new ThumbnailBuilder()
                        .setURL(options.avatarUrl)
                        .setDescription(`${player.name || 'Character'} portrait`)
                )
        );
    } else {
        container.addTextDisplayComponents(heading);
    }
    container.addTextDisplayComponents(
        text(attrs),
        text(
            `### Resources\n❤️ LeP **${stats.le_current ?? 0}/${stats.le_max ?? 0}**  ·  ✨ AsP **${stats.asp_current ?? 0}/${stats.asp_max ?? 0}**\n` +
                `🙏 KaP **${stats.kap_current ?? 0}/${stats.kap_max ?? 0}**  ·  🎲 SchP **${stats.schicksalspunkte_current ?? 0}/${stats.schicksalspunkte_max ?? 0}**`
        ),
        text(
            `### Combat\nINI **${stats.initiative ?? 0}** · AT **${stats.attacke_basis ?? 0}** · PA **${stats.parade_basis ?? 0}** · AW **${stats.ausweichen ?? 0}** · RS **${stats.ruestungsschutz ?? 0}**`
        )
    );
    return componentPayload(container, options);
}

function buildManeuverComponentPayload(maneuver, options = {}) {
    const prerequisites = formatStructuredLines(maneuver.prerequisites).join('\n');
    const rules = formatStructuredLines(maneuver.rules).join('\n');
    const container = new ContainerBuilder().setAccentColor(COLORS.combat);
    container.addTextDisplayComponents(
        text(`# ⚔️ ${maneuver.name}`),
        text(maneuver.description || 'No description.'),
        text(
            `**Action type:** ${maneuver.action_type || 'Any'} · **AP:** ${maneuver.ap_cost ?? 0}\n\n` +
                `### Prerequisites\n${prerequisites}\n\n### Rules\n${rules}`
        )
    );
    return componentPayload(container, options);
}

function buildResourceComponentPayload(characterName, resource, oldValue, newValue, maxValue, action, options = {}) {
    const max = Math.max(0, Number(maxValue) || 0);
    const current = Math.max(0, Number(newValue) || 0);
    const previous = Math.max(0, Number(oldValue) || 0);
    const filled = max > 0 ? Math.max(0, Math.min(12, Math.round((current / max) * 12))) : 0;
    const bar = `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}`;
    const labels = { spend: 'Spent', restore: 'Restored', set: 'Set', show: 'Current' };
    const difference = current - previous;
    const change = action === 'show' ? '' : `\n**Change:** ${difference > 0 ? '+' : ''}${difference}`;
    const container = new ContainerBuilder().setAccentColor(resource.color ?? COLORS.character);
    container.addTextDisplayComponents(
        text(`# ${resource.emoji || '◈'} ${resource.label} · ${labels[action] || 'Updated'}`),
        text(
            `**${characterName}**\n${bar} **${current}/${max}**${change}` +
                (action === 'show' ? '' : `\n-# Previous: ${previous}/${max}`)
        )
    );
    return componentPayload(container, options);
}

function buildNoticeComponentPayload(message, options = {}) {
    const color = options.theme === 'error' ? COLORS.combat : options.theme === 'success' ? 0x2b8a3e : COLORS.character;
    const container = new ContainerBuilder().setAccentColor(color);
    container.addTextDisplayComponents(text(String(message || 'No details available.')));
    return componentPayload(container, options);
}

function componentReplyFlags(ephemeral = false) {
    return MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
}

async function deferForComponents(interaction, { ephemeral = false } = {}) {
    await interaction.deferReply({ flags: componentReplyFlags(ephemeral) });
}

async function editDeferredComponents(interaction, payload) {
    const editable = { ...payload };
    delete editable.flags;
    return interaction.editReply(editable);
}

function messageUsesComponentsV2(message) {
    if (typeof message?.flags?.has === 'function') return message.flags.has(MessageFlags.IsComponentsV2);
    const flags = Number(message?.flags?.bitfield ?? message?.flags ?? 0);
    return (flags & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2;
}

async function editComponentMessage(message, payload) {
    const editable = { ...payload };
    delete editable.flags;
    return message.edit(editable);
}

module.exports = {
    buildAbilityComponentPayload,
    buildCharacterComponentPayload,
    buildCombatComponentPayload,
    buildCombatSetupComponentPayload,
    buildManeuverComponentPayload,
    buildNoticeComponentPayload,
    buildResourceComponentPayload,
    componentReplyFlags,
    deferForComponents,
    editComponentMessage,
    editDeferredComponents,
    messageUsesComponentsV2,
};
