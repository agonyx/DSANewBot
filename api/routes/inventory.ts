import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as inventory from '../../services/inventory';

type AppEnv = { Variables: { ctx: Ctx } };

/** /api/weapons and /api/items — operate on the caller's selected character. */
export const inventoryRoutes = new Hono<AppEnv>();

inventoryRoutes.post('/weapons', async c => c.json(await inventory.addWeapon(c.get('ctx'), await c.req.json()), 201));
inventoryRoutes.get('/weapons', async c => c.json(await inventory.listWeapons(c.get('ctx'))));
inventoryRoutes.delete('/weapons/:id', async c => {
    await inventory.deleteWeapon(c.get('ctx'), Number(c.req.param('id')));
    return c.json({ deleted: true });
});
inventoryRoutes.post('/weapons/:id/equip', async c => {
    const { equippedSlot } = await c.req.json<{ equippedSlot: 'ADAPTIVE' | 'OFFENSE' | 'DEFENSE' }>();
    return c.json(await inventory.equipWeapon(c.get('ctx'), { weaponId: Number(c.req.param('id')), equippedSlot }));
});
inventoryRoutes.post('/weapons/:id/unequip', async c =>
    c.json(await inventory.unequipWeapon(c.get('ctx'), Number(c.req.param('id'))))
);

inventoryRoutes.post('/items', async c => c.json(await inventory.addItem(c.get('ctx'), await c.req.json()), 201));
inventoryRoutes.get('/items', async c => c.json(await inventory.listItems(c.get('ctx'))));
inventoryRoutes.delete('/items/:id', async c => {
    await inventory.removeItem(c.get('ctx'), Number(c.req.param('id')));
    return c.json({ deleted: true });
});
