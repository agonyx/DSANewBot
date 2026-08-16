const DISCORD_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

async function readAttachmentBytes(attachment, { maxBytes = 1_000_000, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
    if (!attachment?.url) throw new Error('An attachment is required');
    if (Number(attachment.size || 0) > maxBytes) throw new Error(`Attachment must be at most ${maxBytes} bytes`);
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || !DISCORD_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error('Attachment must be hosted by Discord');
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error(`Could not download attachment (HTTP ${response.status})`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error(`Attachment must be at most ${maxBytes} bytes`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`Attachment must be at most ${maxBytes} bytes`);
    return { bytes, contentType: response.headers.get('content-type') || attachment.contentType || null };
}

async function readJsonAttachment(attachment, { maxBytes = 1_000_000, fetchImpl = fetch } = {}) {
    if (!attachment?.url) throw new Error('A JSON attachment is required');
    const { bytes } = await readAttachmentBytes(attachment, { maxBytes, fetchImpl });
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new Error('Attachment is not valid JSON');
    }
}

module.exports = { DISCORD_ATTACHMENT_HOSTS, readAttachmentBytes, readJsonAttachment };
