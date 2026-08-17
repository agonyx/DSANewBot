import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { webhookSubscriptions } from '../db/schema';
import { httpError } from '../db/operations/errors';
import { normalizeEventTypes, normalizeName, validateHttpsUrl } from '../utils/campaignUtils';
import { createLogger } from '../utils/logger';
import type { Ctx } from './_ctx';
import { requireDmGuild } from './guildAuth';

const log = createLogger('webhooks');
const MAX_WEBHOOKS_PER_GUILD = 25;

function validationError(error: unknown): never {
    if (error instanceof Error) throw httpError(400, error.message);
    throw httpError(400, 'Invalid webhook');
}

function redact(row: typeof webhookSubscriptions.$inferSelect) {
    const url = new URL(row.url);
    return { ...row, url: `${url.protocol}//${url.host}/…` };
}

function isPrivateAddress(address: string): boolean {
    if (isIP(address) === 6) {
        const value = address.toLowerCase();
        return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
    }
    return (
        /^127\./.test(address) ||
        /^10\./.test(address) ||
        /^192\.168\./.test(address) ||
        /^169\.254\./.test(address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address)
    );
}

async function assertPublicTarget(rawUrl: string): Promise<string> {
    const url = validateHttpsUrl(rawUrl, 'webhook URL');
    const addresses = await lookup(new URL(url).hostname, { all: true });
    if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) {
        throw new Error('Webhook URL resolved to a private or unavailable address');
    }
    return url;
}

export async function createWebhookSubscription(
    ctx: Ctx,
    input: { guildId: string; name: string; url: string; events?: string }
) {
    const guildId = requireDmGuild(ctx, input.guildId);
    let name: string;
    let url: string;
    let eventTypes: string[];
    try {
        name = normalizeName(input.name, 'webhook name');
        url = await assertPublicTarget(input.url);
        eventTypes = normalizeEventTypes(input.events);
    } catch (error) {
        return validationError(error);
    }
    const current = await db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.guild_id, guildId))
        .limit(MAX_WEBHOOKS_PER_GUILD);
    if (current.length >= MAX_WEBHOOKS_PER_GUILD) throw httpError(409, 'A server can configure at most 25 webhooks');
    const [row] = await db
        .insert(webhookSubscriptions)
        .values({
            guild_id: guildId,
            name,
            url,
            event_types: eventTypes,
            created_by_discord_id: ctx.discordId,
        })
        .returning();
    return redact(row);
}

export async function listWebhookSubscriptions(ctx: Ctx, guildId: string) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    const rows = await db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.guild_id, scopedGuildId))
        .orderBy(asc(webhookSubscriptions.name))
        .limit(MAX_WEBHOOKS_PER_GUILD);
    return rows.map(redact);
}

export async function deleteWebhookSubscription(ctx: Ctx, guildId: string, webhookId: string) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    const [deleted] = await db
        .delete(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.guild_id, scopedGuildId), eq(webhookSubscriptions.id, webhookId)))
        .returning();
    if (!deleted) throw httpError(404, 'Webhook not found');
    return redact(deleted);
}

export async function dispatchWebhookEvent(
    guildId: string,
    eventType: 'dice.roll' | 'campaign.updated' | 'character.imported',
    data: Record<string, unknown>
) {
    const subscriptions = await db
        .select()
        .from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.guild_id, guildId), eq(webhookSubscriptions.enabled, true)))
        .limit(MAX_WEBHOOKS_PER_GUILD);
    const targets = subscriptions.filter(row => row.event_types.includes('*') || row.event_types.includes(eventType));
    if (!targets.length) return { delivered: 0, failed: 0 };
    const secret = process.env.WEBHOOK_SIGNING_SECRET;
    if (!secret) {
        log.warn(
            { guildId, eventType, targets: targets.length },
            'Webhook delivery skipped: signing secret is not configured'
        );
        return { delivered: 0, failed: targets.length };
    }
    const payload = JSON.stringify({
        id: randomUUID(),
        type: eventType,
        createdAt: new Date().toISOString(),
        guildId,
        data,
    });
    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    const results = await Promise.allSettled(
        targets.map(async target => {
            await assertPublicTarget(target.url);
            const response = await fetch(target.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'user-agent': 'DSANewBot-Webhook/1.0',
                    'x-dsanewbot-event': eventType,
                    'x-dsanewbot-signature': signature,
                },
                body: payload,
                signal: AbortSignal.timeout(5000),
                redirect: 'error',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        })
    );
    let delivered = 0;
    let failed = 0;
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') delivered += 1;
        else {
            failed += 1;
            log.warn(
                { webhookId: targets[index].id, webhookName: targets[index].name, eventType, error: result.reason },
                'Webhook delivery failed'
            );
        }
    });
    return { delivered, failed };
}

export async function testWebhookSubscription(ctx: Ctx, guildId: string) {
    const scopedGuildId = requireDmGuild(ctx, guildId);
    return dispatchWebhookEvent(scopedGuildId, 'campaign.updated', { action: 'test' });
}
