import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import { deleteDiceMacro, getDiceMacro, listDiceMacros, saveDiceMacro } from '../../services/diceMacros';
import { rollDice } from '../../utils/rollUtil';
import { rollNotation } from '../../utils/diceUtils';

type AppEnv = { Variables: { ctx: Ctx } };

export const diceMacroRoutes = new Hono<AppEnv>();

diceMacroRoutes.get('/', async c => c.json(await listDiceMacros(c.get('ctx'))));

diceMacroRoutes.post('/', async c => {
    const body = await c.req.json<{ name: string; notation: string }>();
    return c.json(await saveDiceMacro(c.get('ctx'), body), 201);
});

diceMacroRoutes.post('/:name/roll', async c => {
    const result = await getDiceMacro(c.get('ctx'), c.req.param('name'));
    const roll = rollNotation(result.macro.notation, rollDice);
    return c.json({ ...result, roll });
});

diceMacroRoutes.delete('/:name', async c => c.json(await deleteDiceMacro(c.get('ctx'), c.req.param('name'))));
