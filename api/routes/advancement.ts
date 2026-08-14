import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as advancement from '../../services/advancement';

type AppEnv = { Variables: { ctx: Ctx } };

/** AP ledger and one-step character improvement routes for the selected character. */
export const advancementRoutes = new Hono<AppEnv>();

advancementRoutes.get('/', async c => c.json(await advancement.getApSummary(c.get('ctx'))));
advancementRoutes.get('/options', async c => c.json(await advancement.getAdvancementOptions(c.get('ctx'))));
advancementRoutes.get('/special-abilities', async c =>
    c.json(await advancement.listLearnedSpecialAbilities(c.get('ctx')))
);

advancementRoutes.post('/grant', async c => {
    const body = await c.req.json<{ amount: number; reason: string }>();
    return c.json(await advancement.grantAp(c.get('ctx'), body), 201);
});

advancementRoutes.post('/attributes', async c => {
    const body = await c.req.json<{ attribute: string }>();
    return c.json(await advancement.raiseAttribute(c.get('ctx'), body));
});

advancementRoutes.post('/talents', async c => {
    const body = await c.req.json<{ talentId: number }>();
    return c.json(await advancement.raiseTalent(c.get('ctx'), body));
});

advancementRoutes.post('/supernatural', async c => {
    const body = await c.req.json<{
        abilityType: advancement.SupernaturalAbilityType;
        abilityId: string;
    }>();
    return c.json(await advancement.raiseSupernaturalAbility(c.get('ctx'), body));
});

advancementRoutes.post('/special-abilities', async c => {
    const body = await c.req.json<{ abilityId: string; confirmedPrerequisites?: boolean }>();
    return c.json(await advancement.learnSpecialAbility(c.get('ctx'), body), 201);
});
