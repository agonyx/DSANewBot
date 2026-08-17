const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { importNormalizedCharacter, previewCharacterImport } = require('../services/characterRecords');
const { parseCharacterImport } = require('../utils/characterImport');
const { DSA_PDF_LIMITS, parseDsaCharacterPdf } = require('../utils/characterPdfImport');
const { readAttachmentBytes } = require('../utils/attachmentJson');
const { createEmbed, truncateText } = require('../utils/embedUtils');
const { createLogger } = require('../utils/logger');
const {
    DEFAULT_IMPORT_PREVIEW_TTL_MS,
    importPreviewStore,
    inspectImportPreview,
    claimImportPreview,
    completeImportPreview,
    releaseImportPreview,
} = require('../utils/importPreviewState');

const log = createLogger('import-character');
const JSON_LIMIT = 2_000_000;

function summaryCounts(counts) {
    return (
        Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([name, count]) => `${name}: ${count}`)
            .join(' · ') || 'Core identity and stats only'
    );
}

function catalogSummary(groups) {
    const totals = Object.values(groups).reduce(
        (sum, group) => {
            for (const key of Object.keys(sum)) sum[key] += group[key] || 0;
            return sum;
        },
        { exact: 0, normalized: 0, alias: 0, ambiguous: 0, unresolved: 0 }
    );
    return Object.entries(totals)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ');
}

function previewEmbed(preview) {
    const warnings = [...preview.warnings];
    if (preview.unresolvedFieldCount)
        warnings.push(`${preview.unresolvedFieldCount} non-empty fields will be preserved in the import report.`);
    return createEmbed(warnings.length ? 'warning' : 'character')
        .setTitle('Character import preview')
        .setDescription(
            `Proposed character: **${preview.proposedName}**\nSource: **${preview.profileId || preview.source}**`
        )
        .addFields(
            { name: 'Mapped', value: truncateText(summaryCounts(preview.mappedCounts), 1024) },
            { name: 'Catalog reconciliation', value: truncateText(catalogSummary(preview.catalogMatches), 1024) },
            {
                name: 'Warnings & omissions',
                value: truncateText(warnings.join('\n') || 'None', 1024),
            }
        )
        .setFooter({ text: 'Nothing has been written yet · preview expires in 10 minutes' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('import-character')
        .setDescription('Preview a Foundry, Optolith, DSANewBot JSON, or supported fillable DSA PDF import')
        .addAttachmentOption(option =>
            option.setName('file').setDescription('Character JSON (2 MB) or supported PDF (10 MiB)').setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const attachment = interaction.options.getAttachment('file', true);
            const pdfHint =
                attachment.contentType?.toLowerCase() === 'application/pdf' ||
                String(attachment.name || '')
                    .toLowerCase()
                    .endsWith('.pdf');
            const maxBytes = pdfHint ? DSA_PDF_LIMITS.maxBytes : JSON_LIMIT;
            const { bytes, contentType } = await readAttachmentBytes(attachment, { maxBytes });
            const isPdf = new TextDecoder('ascii').decode(bytes.slice(0, 5)) === '%PDF-';
            let parsed;
            let inventory = null;
            if (isPdf) {
                const result = await parseDsaCharacterPdf(bytes, { mimeType: contentType });
                parsed = result.character;
                inventory = result.inventory;
                log.info(
                    {
                        profile: result.profile.id,
                        version: result.profile.version,
                        fields: inventory.fieldCount,
                        pages: result.profile.pageCount,
                    },
                    'Character PDF profile parsed'
                );
            } else {
                if (bytes.byteLength > JSON_LIMIT)
                    throw new Error(`JSON attachment must be at most ${JSON_LIMIT} bytes`);
                let raw;
                try {
                    raw = JSON.parse(new TextDecoder().decode(bytes));
                } catch {
                    throw new Error('Attachment is neither a supported PDF nor valid JSON');
                }
                parsed = parseCharacterImport(raw);
            }
            const preview = await previewCharacterImport(parsed);
            const id = randomUUID().replaceAll('-', '');
            importPreviewStore(interaction.client).set(id, {
                id,
                userId: interaction.user.id,
                guildId: interaction.guildId || undefined,
                parsed,
                preview,
                inventory,
                status: 'READY',
                result: null,
                expiresAt: Date.now() + DEFAULT_IMPORT_PREVIEW_TTL_MS,
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`charimp_${id}_confirm`)
                    .setLabel('Import')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`charimp_${id}_cancel`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );
            return interaction.editReply({ embeds: [previewEmbed(preview)], components: [row] });
        } catch (error) {
            log.error({ error }, 'Character import preview failed');
            return interaction.editReply(
                `❌ ${error.status ? error.message : error.message || 'Character import failed.'}`
            );
        }
    },

    async handleImportButton(interaction) {
        const [, id, decision] = interaction.customId.split('_');
        const inspected = inspectImportPreview(interaction.client, id, interaction.user.id);
        if (inspected.code === 'EXPIRED') {
            return interaction.reply({
                content: '❌ This import preview expired. Upload the file again.',
                ephemeral: true,
            });
        }
        if (inspected.code === 'FORBIDDEN') {
            return interaction.reply({
                content: '❌ Only the user who uploaded this character can confirm it.',
                ephemeral: true,
            });
        }
        const state = inspected.state;
        if (decision === 'cancel') {
            state.status = 'CANCELLED';
            await interaction.update({
                content: 'Import cancelled. No character was created.',
                embeds: [],
                components: [],
            });
            return;
        }
        const claim = claimImportPreview(state);
        if (claim === 'COMPLETE') {
            return interaction.reply({
                content: `ℹ️ **${state.result.player.name}** was already imported.`,
                ephemeral: true,
            });
        }
        if (claim === 'IMPORTING') {
            return interaction.reply({ content: 'ℹ️ This import is already being processed.', ephemeral: true });
        }
        if (claim !== 'CLAIMED') {
            return interaction.reply({ content: '❌ This import preview is no longer active.', ephemeral: true });
        }
        await interaction.deferUpdate();
        try {
            const result = await importNormalizedCharacter(
                { discordId: interaction.user.id },
                state.parsed,
                state.guildId
            );
            completeImportPreview(state, result);
            const unresolved = state.preview.unresolvedFieldCount
                ? ` ${state.preview.unresolvedFieldCount} unresolved fields were saved; select the character and use \`/character import-report\` to inspect them.`
                : '';
            return interaction.editReply({
                content: `✅ Imported **${result.player.name}**. Use \`/character select\` to activate it.${unresolved}`,
                embeds: [],
                components: [],
            });
        } catch (error) {
            releaseImportPreview(state);
            log.error({ error }, 'Confirmed character import failed');
            return interaction.editReply({
                content: `❌ ${error.data?.error || error.message}`,
                embeds: [],
                components: [],
            });
        }
    },
};
