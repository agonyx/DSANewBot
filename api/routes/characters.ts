import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as characters from '../../services/characters';
import { exportCharacterSheet } from '../../services/characterExports';
import { importCharacter } from '../../services/characterRecords';

type AppEnv = { Variables: { ctx: Ctx } };

/** /api/characters — character management (all ctx-authenticated). */
export const characterRoutes = new Hono<AppEnv>();

characterRoutes.post('/', async c => {
    const { name } = await c.req.json<{ name: string }>();
    return c.json(await characters.createCharacter(c.get('ctx'), { name }), 201);
});

characterRoutes.get('/', async c => {
    return c.json(await characters.listCharacters(c.get('ctx')));
});

characterRoutes.get('/me', async c => {
    return c.json(await characters.getCharacterSheet(c.get('ctx')));
});

characterRoutes.get('/me/export', async c => {
    const result = await exportCharacterSheet(c.get('ctx'));
    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return c.body(result.text);
});

characterRoutes.post('/import', async c => {
    const body = await c.req.json<unknown>();
    return c.json(await importCharacter(c.get('ctx'), body, c.req.query('guildId')), 201);
});

characterRoutes.post('/:id/select', async c => {
    const id = Number(c.req.param('id'));
    return c.json(await characters.selectCharacter(c.get('ctx'), id));
});

characterRoutes.patch('/stats', async c => {
    const { statKey, value } = await c.req.json<{ statKey: string; value: number }>();
    return c.json(await characters.updateStat(c.get('ctx'), { statKey, value }));
});

characterRoutes.delete('/:id', async c => {
    const id = Number(c.req.param('id'));
    return c.json(await characters.deleteCharacter(c.get('ctx'), id));
});
