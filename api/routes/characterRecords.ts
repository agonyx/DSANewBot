import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as records from '../../services/characterRecords';
import type { CharacterRecordKind } from '../../utils/characterRecordUtils';

type AppEnv = { Variables: { ctx: Ctx } };

export const characterRecordRoutes = new Hono<AppEnv>();

characterRecordRoutes.get('/', async c => {
    return c.json(await records.listCharacterRecords(c.get('ctx'), c.req.query('kind') as CharacterRecordKind));
});

characterRecordRoutes.post('/', async c => {
    const body = await c.req.json<{
        kind: CharacterRecordKind;
        name: string;
        description?: string;
        status?: string;
        data?: Record<string, unknown>;
    }>();
    return c.json(await records.createCharacterRecord(c.get('ctx'), body), 201);
});

characterRecordRoutes.patch('/:id', async c => {
    const body = await c.req.json<{ name?: string; status?: string; data?: Record<string, unknown> }>();
    return c.json(await records.updateCharacterRecord(c.get('ctx'), { recordId: c.req.param('id'), ...body }));
});

characterRecordRoutes.delete('/:id', async c => {
    return c.json(await records.deleteCharacterRecord(c.get('ctx'), c.req.param('id')));
});

characterRecordRoutes.put('/background/profile', async c => {
    const body = await c.req.json<{ culture: string; profession: string; notes?: string }>();
    return c.json(await records.setCharacterBackground(c.get('ctx'), body));
});
