import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as campaign from '../../services/campaign';
import * as webhooks from '../../services/webhooks';
import type { CampaignRecordKind } from '../../utils/campaignUtils';

type AppEnv = { Variables: { ctx: Ctx } };

/** Guild campaign records, world state, backups, and outbound integrations. */
export const campaignRoutes = new Hono<AppEnv>();

campaignRoutes.get('/:guildId/records', async c => {
    const kind = c.req.query('kind') as CampaignRecordKind;
    return c.json(await campaign.listCampaignRecords(c.get('ctx'), c.req.param('guildId'), kind));
});

campaignRoutes.post('/:guildId/records', async c => {
    const body = await c.req.json<{
        kind: CampaignRecordKind;
        name: string;
        status?: string;
        data?: Record<string, unknown>;
    }>();
    return c.json(await campaign.createCampaignRecord(c.get('ctx'), { guildId: c.req.param('guildId'), ...body }), 201);
});

campaignRoutes.get('/:guildId/records/:id', async c => {
    return c.json(await campaign.getCampaignRecord(c.get('ctx'), c.req.param('guildId'), c.req.param('id')));
});

campaignRoutes.patch('/:guildId/records/:id', async c => {
    const body = await c.req.json<{ name?: string; status?: string; data?: Record<string, unknown> }>();
    return c.json(
        await campaign.updateCampaignRecord(c.get('ctx'), {
            guildId: c.req.param('guildId'),
            recordId: c.req.param('id'),
            ...body,
        })
    );
});

campaignRoutes.delete('/:guildId/records/:id', async c => {
    return c.json(await campaign.deleteCampaignRecord(c.get('ctx'), c.req.param('guildId'), c.req.param('id')));
});

campaignRoutes.get('/:guildId/world', async c => {
    return c.json(await campaign.getWorldState(c.get('ctx'), c.req.param('guildId')));
});

campaignRoutes.put('/:guildId/world', async c => {
    const body = await c.req.json<{ currentTime?: string; weather?: string; randomizeWeather?: boolean }>();
    return c.json(await campaign.setWorldState(c.get('ctx'), { guildId: c.req.param('guildId'), ...body }));
});

campaignRoutes.get('/:guildId/backup', async c => {
    return c.json(await campaign.createCampaignBackup(c.get('ctx'), c.req.param('guildId')));
});

campaignRoutes.post('/:guildId/restore', async c => {
    const body = await c.req.json<{ backup: unknown; mode?: 'MERGE' | 'REPLACE' }>();
    return c.json(
        await campaign.restoreCampaignBackup(c.get('ctx'), c.req.param('guildId'), body.backup, body.mode || 'MERGE')
    );
});

campaignRoutes.get('/:guildId/webhooks', async c => {
    return c.json(await webhooks.listWebhookSubscriptions(c.get('ctx'), c.req.param('guildId')));
});

campaignRoutes.post('/:guildId/webhooks', async c => {
    const body = await c.req.json<{ name: string; url: string; events?: string }>();
    return c.json(
        await webhooks.createWebhookSubscription(c.get('ctx'), { guildId: c.req.param('guildId'), ...body }),
        201
    );
});

campaignRoutes.delete('/:guildId/webhooks/:id', async c => {
    return c.json(await webhooks.deleteWebhookSubscription(c.get('ctx'), c.req.param('guildId'), c.req.param('id')));
});

campaignRoutes.post('/:guildId/webhooks/test', async c => {
    return c.json(await webhooks.testWebhookSubscription(c.get('ctx'), c.req.param('guildId')));
});
