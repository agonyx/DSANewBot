const { EmbedBuilder } = require('discord.js');

const EMBED_LIMITS = Object.freeze({
    description: 4096,
    fieldName: 256,
    fieldValue: 1024,
    fields: 25,
    embeds: 10,
    total: 6000,
});

const EMBED_COLORS = Object.freeze({
    neutral: 0x2b2d31,
    info: 0x3498db,
    success: 0x2ecc71,
    warning: 0xf0a202,
    danger: 0xe74c3c,
    character: 0x3b82f6,
    combat: 0xc0392b,
    inventory: 0x2d9cdb,
    equipment: 0x607d8b,
    economy: 0xd4af37,
    magic: 0x8e44ad,
    karma: 0xd4ac0d,
    rules: 0x8b6f47,
});

function resolveColor(theme) {
    if (typeof theme === 'number') return theme;
    return EMBED_COLORS[theme] ?? EMBED_COLORS.neutral;
}

function createEmbed(theme = 'neutral') {
    return new EmbedBuilder().setColor(resolveColor(theme));
}

function truncateText(value, maxLength, fallback = '—') {
    const text = value == null || value === '' ? fallback : String(value);
    if (text.length <= maxLength) return text;
    if (maxLength <= 1) return '…'.slice(0, maxLength);

    const candidate = text.slice(0, maxLength - 1);
    const lastBreak = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const cutoff = lastBreak >= Math.floor(maxLength * 0.6) ? lastBreak : candidate.length;
    return `${candidate.slice(0, cutoff).trimEnd()}…`;
}

function splitLongLine(line, maxLength) {
    const parts = [];
    let remainder = String(line);

    while (remainder.length > maxLength) {
        const candidate = remainder.slice(0, maxLength);
        const lastBreak = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('/'));
        const cutoff = lastBreak >= Math.floor(maxLength * 0.5) ? lastBreak + 1 : maxLength;
        parts.push(remainder.slice(0, cutoff).trimEnd());
        remainder = remainder.slice(cutoff).trimStart();
    }

    if (remainder) parts.push(remainder);
    return parts.length ? parts : ['—'];
}

function chunkLines(lines, maxLength = EMBED_LIMITS.description) {
    const normalized = (Array.isArray(lines) ? lines : [lines])
        .flatMap(line => String(line ?? '').split('\n'))
        .flatMap(line => splitLongLine(line, maxLength));
    const chunks = [];
    let current = '';

    for (const line of normalized) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length <= maxLength) {
            current = next;
            continue;
        }
        if (current) chunks.push(current);
        current = line;
    }

    if (current) chunks.push(current);
    return chunks.length ? chunks : ['—'];
}

function makeFooter(user, prefix = 'Requested by') {
    if (!user) return undefined;
    const username = user.displayName || user.username || 'Unknown user';
    const iconURL = typeof user.avatarURL === 'function' ? user.avatarURL() : undefined;
    return { text: `${prefix} ${username}`, ...(iconURL ? { iconURL } : {}) };
}

function progressBar(current, maximum, segments = 10) {
    const safeMaximum = Math.max(0, Number(maximum) || 0);
    const safeCurrent = Math.max(0, Number(current) || 0);
    const ratio = safeMaximum > 0 ? Math.min(1, safeCurrent / safeMaximum) : 0;
    const filled = Math.round(ratio * segments);
    return `${'■'.repeat(filled)}${'□'.repeat(segments - filled)}`;
}

function pageTitle(title, page, totalPages) {
    if (totalPages <= 1) return truncateText(title, EMBED_LIMITS.fieldName);
    const suffix = ` · ${page}/${totalPages}`;
    return `${truncateText(title, EMBED_LIMITS.fieldName - suffix.length)}${suffix}`;
}

function buildListEmbeds({
    title,
    lines,
    theme = 'neutral',
    description,
    emptyMessage = 'Nothing to show.',
    footer,
    timestamp = false,
    maxDescriptionLength = 3800,
}) {
    const sourceLines = Array.isArray(lines) && lines.length ? lines : [emptyMessage];
    const chunks = chunkLines(sourceLines, Math.min(maxDescriptionLength, EMBED_LIMITS.description));
    const visibleChunks = chunks.slice(0, EMBED_LIMITS.embeds);
    const omittedPages = chunks.length - visibleChunks.length;

    if (omittedPages > 0) {
        const notice = `\n\n_Additional results were omitted (${omittedPages} more page${omittedPages === 1 ? '' : 's'}). Refine the command filter._`;
        visibleChunks[visibleChunks.length - 1] = truncateText(
            `${visibleChunks[visibleChunks.length - 1]}${notice}`,
            maxDescriptionLength
        );
    }

    const totalPages = visibleChunks.length;
    return visibleChunks.map((chunk, index) => {
        const embed = createEmbed(theme).setTitle(pageTitle(title, index + 1, totalPages));
        const body = index === 0 && description ? `${description}\n\n${chunk}` : chunk;
        embed.setDescription(truncateText(body, EMBED_LIMITS.description));
        if (footer) embed.setFooter(footer);
        if (timestamp) embed.setTimestamp(timestamp === true ? undefined : timestamp);
        return embed;
    });
}

function buildSectionEmbeds({ title, sections, theme = 'neutral', description, footer, timestamp = false }) {
    const fields = [];
    for (const section of sections) {
        const chunks = chunkLines(section.lines ?? section.value ?? '—', 1000);
        chunks.forEach((value, index) => {
            const continuation = index === 0 ? '' : ` (${index + 1})`;
            fields.push({
                name: truncateText(`${section.name}${continuation}`, EMBED_LIMITS.fieldName),
                value: truncateText(value, EMBED_LIMITS.fieldValue),
                inline: Boolean(section.inline),
            });
        });
    }

    const pages = [];
    let page = [];
    let pageLength = description?.length || 0;
    for (const field of fields) {
        const fieldLength = field.name.length + field.value.length;
        if (page.length >= 24 || (page.length > 0 && pageLength + fieldLength > 5200)) {
            pages.push(page);
            page = [];
            pageLength = 0;
        }
        page.push(field);
        pageLength += fieldLength;
    }
    if (page.length || !pages.length) pages.push(page);

    const visiblePages = pages.slice(0, EMBED_LIMITS.embeds);
    const omittedPages = pages.length - visiblePages.length;
    const totalPages = visiblePages.length;
    return visiblePages.map((pageFields, index) => {
        const embed = createEmbed(theme).setTitle(pageTitle(title, index + 1, totalPages));
        if (index === 0 && description) embed.setDescription(truncateText(description, EMBED_LIMITS.description));
        if (index === totalPages - 1 && omittedPages > 0) {
            embed.setDescription(
                `Additional sections were omitted (${omittedPages} more page${omittedPages === 1 ? '' : 's'}). Refine the command filter.`
            );
        }
        if (pageFields.length) embed.addFields(pageFields);
        if (footer) embed.setFooter(footer);
        if (timestamp) embed.setTimestamp(timestamp === true ? undefined : timestamp);
        return embed;
    });
}

function humanizeKey(key) {
    const abbreviations = new Set(['ap', 'at', 'be', 'ff', 'ge', 'ini', 'kk', 'kl', 'ko', 'mu', 'pa', 'rs']);
    return String(key)
        .split('_')
        .map(part =>
            abbreviations.has(part.toLowerCase())
                ? part.toUpperCase()
                : `${part[0]?.toUpperCase() || ''}${part.slice(1)}`
        )
        .join(' ');
}

function formatStructuredValue(value) {
    if (Array.isArray(value)) return value.map(formatStructuredValue).join(', ') || 'None';
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    if (value == null || value === '') return 'None';
    if (typeof value === 'object') {
        return Object.entries(value)
            .map(([key, nested]) => `${humanizeKey(key)}: ${formatStructuredValue(nested)}`)
            .join('; ');
    }
    return String(value).replaceAll('_', ' ');
}

function formatStructuredLines(value) {
    if (!value || typeof value !== 'object' || !Object.keys(value).length) return ['None'];
    return Object.entries(value).map(([key, entry]) => `**${humanizeKey(key)}:** ${formatStructuredValue(entry)}`);
}

module.exports = {
    EMBED_COLORS,
    EMBED_LIMITS,
    buildListEmbeds,
    buildSectionEmbeds,
    chunkLines,
    createEmbed,
    formatStructuredLines,
    formatStructuredValue,
    humanizeKey,
    makeFooter,
    progressBar,
    truncateText,
};
