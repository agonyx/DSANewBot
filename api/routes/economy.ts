import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as economy from '../../services/economy';
import * as equipment from '../../services/equipment';
import * as inventory from '../../services/inventory';
import * as loot from '../../services/loot';
import * as trades from '../../services/trades';

type AppEnv = { Variables: { ctx: Ctx } };

export const economyRoutes = new Hono<AppEnv>();

economyRoutes.get('/wallet', async c => c.json(await economy.getWallet(c.get('ctx'))));
economyRoutes.post('/wallet/adjust', async c => c.json(await economy.adjustWallet(c.get('ctx'), await c.req.json())));

economyRoutes.get('/catalog', async c =>
    c.json(
        await economy.listCatalog(c.get('ctx'), {
            search: c.req.query('search'),
            category: c.req.query('category'),
            limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        })
    )
);
economyRoutes.get('/catalog/:id', async c => c.json(await economy.getCatalogEntry(c.get('ctx'), c.req.param('id'))));
economyRoutes.post('/shop/buy', async c => c.json(await economy.buyCatalogItem(c.get('ctx'), await c.req.json()), 201));
economyRoutes.post('/shop/sell', async c => c.json(await economy.sellOwnedAsset(c.get('ctx'), await c.req.json())));

economyRoutes.get('/equipment', async c => c.json(await equipment.getEquipmentSummary(c.get('ctx'))));
economyRoutes.post('/equipment/items/:id/equip', async c => {
    const body = await c.req.json<{ slot?: string | null }>();
    return c.json(await equipment.equipItem(c.get('ctx'), { itemId: Number(c.req.param('id')), slot: body.slot }));
});
economyRoutes.post('/equipment/items/:id/unequip', async c =>
    c.json(await equipment.unequipItem(c.get('ctx'), Number(c.req.param('id'))))
);
economyRoutes.post('/equipment/weapons/:id/unequip', async c =>
    c.json(await inventory.unequipWeapon(c.get('ctx'), Number(c.req.param('id'))))
);

economyRoutes.post('/trades', async c => c.json(await trades.createTrade(c.get('ctx'), await c.req.json()), 201));
economyRoutes.get('/trades', async c => c.json(await trades.listTrades(c.get('ctx'))));
economyRoutes.post('/trades/:id/accept', async c => c.json(await trades.acceptTrade(c.get('ctx'), c.req.param('id'))));
economyRoutes.post('/trades/:id/decline', async c =>
    c.json(await trades.declineTrade(c.get('ctx'), c.req.param('id')))
);
economyRoutes.post('/trades/:id/cancel', async c => c.json(await trades.cancelTrade(c.get('ctx'), c.req.param('id'))));

economyRoutes.post('/loot', async c => c.json(await loot.generateLoot(c.get('ctx'), await c.req.json()), 201));
economyRoutes.get('/loot', async c => c.json(await loot.listLootPools(c.get('ctx'), c.req.query('sessionId') ?? '')));
economyRoutes.get('/loot/:id', async c => c.json(await loot.getLootPool(c.get('ctx'), c.req.param('id'))));
economyRoutes.post('/loot/:id/award', async c => {
    const body = await c.req.json<Omit<Parameters<typeof loot.awardLoot>[1], 'poolId'>>();
    return c.json(await loot.awardLoot(c.get('ctx'), { ...body, poolId: c.req.param('id') }));
});
economyRoutes.post('/loot/:id/cancel', async c => c.json(await loot.cancelLootPool(c.get('ctx'), c.req.param('id'))));
