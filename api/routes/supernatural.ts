import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as supernatural from '../../services/supernatural';

type AppEnv = { Variables: { ctx: Ctx } };

export const supernaturalRoutes = new Hono<AppEnv>();

supernaturalRoutes.get('/profile', async c => c.json(await supernatural.getSupernaturalProfile(c.get('ctx'))));
supernaturalRoutes.patch('/profile', async c =>
    c.json(await supernatural.setSupernaturalProfile(c.get('ctx'), await c.req.json()))
);

supernaturalRoutes.get('/spells', async c =>
    c.json(
        await supernatural.listSpellCatalog(c.get('ctx'), {
            search: c.req.query('search'),
            kind: c.req.query('kind'),
            limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        })
    )
);
supernaturalRoutes.get('/spells/learned', async c => c.json(await supernatural.listLearnedSpells(c.get('ctx'))));
supernaturalRoutes.get('/spells/:id', async c => c.json(await supernatural.getSpell(c.get('ctx'), c.req.param('id'))));
supernaturalRoutes.post('/spells/:id/learn', async c =>
    c.json(await supernatural.learnSpell(c.get('ctx'), { spellId: c.req.param('id') }), 201)
);

supernaturalRoutes.get('/liturgies', async c =>
    c.json(
        await supernatural.listLiturgyCatalog(c.get('ctx'), {
            search: c.req.query('search'),
            kind: c.req.query('kind'),
            limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
        })
    )
);
supernaturalRoutes.get('/liturgies/learned', async c => c.json(await supernatural.listLearnedLiturgies(c.get('ctx'))));
supernaturalRoutes.get('/liturgies/:id', async c =>
    c.json(await supernatural.getLiturgy(c.get('ctx'), c.req.param('id')))
);
supernaturalRoutes.post('/liturgies/:id/learn', async c =>
    c.json(await supernatural.learnLiturgy(c.get('ctx'), { liturgyId: c.req.param('id') }), 201)
);

supernaturalRoutes.post('/cast', async c =>
    c.json(await supernatural.castAbility(c.get('ctx'), await c.req.json()), 201)
);
supernaturalRoutes.get('/castings', async c => c.json(await supernatural.listCastings(c.get('ctx'))));
supernaturalRoutes.post('/castings/:id/complete', async c =>
    c.json(await supernatural.completeCasting(c.get('ctx'), c.req.param('id')))
);
supernaturalRoutes.post('/castings/:id/cancel', async c =>
    c.json(await supernatural.cancelCasting(c.get('ctx'), c.req.param('id')))
);
supernaturalRoutes.get('/effects', async c => c.json(await supernatural.listSupernaturalEffects(c.get('ctx'))));
supernaturalRoutes.post('/miracle', async c =>
    c.json(await supernatural.invokeMiracle(c.get('ctx'), await c.req.json()), 201)
);
