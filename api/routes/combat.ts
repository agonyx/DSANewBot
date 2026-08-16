import { Hono } from 'hono';
import type { Ctx } from '../../services/_ctx';
import * as combat from '../../services/combat';
import type { HitZone } from '../../utils/combatEffectUtils';
import type { DefenseChoice } from '../../utils/combatRules';
import type { ResourceKey } from '../../services/resources';

type AppEnv = { Variables: { ctx: Ctx } };

/**
 * /api/combat — transactional, sessionId-keyed combat lifecycle + resolution.
 * The website drives combat through these; the Discord handlers call the same
 * services in-process. All ctx-authenticated (DM-only actions enforce it).
 */
export const combatRoutes = new Hono<AppEnv>();

combatRoutes.post('/', async c => {
    const { channelId, dmUserId } = await c.req.json<{ channelId: string; dmUserId: string }>();
    return c.json(await combat.createCombatSession(c.get('ctx'), { channelId, dmUserId }), 201);
});

combatRoutes.get('/log', async c =>
    c.json(
        await combat.getCombatLog(c.get('ctx'), {
            sessionId: c.req.query('sessionId'),
            channelId: c.req.query('channelId'),
        })
    )
);

combatRoutes.get('/:sessionId', async c =>
    c.json(await combat.getCombatSession(c.get('ctx'), c.req.param('sessionId')))
);

combatRoutes.post('/:sessionId/combatants', async c => {
    const body = await c.req.json();
    return c.json(await combat.addCombatant(c.get('ctx'), { ...body, sessionId: c.req.param('sessionId') }), 201);
});

combatRoutes.delete('/:sessionId/combatants/:combatantId', async c => {
    return c.json(
        await combat.removeCombatant(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            combatantId: c.req.param('combatantId'),
        })
    );
});

combatRoutes.post('/:sessionId/begin', async c =>
    c.json(await combat.beginCombat(c.get('ctx'), c.req.param('sessionId')))
);

combatRoutes.post('/:sessionId/attack', async c => {
    const { attackerId, targetId, maneuverId, attackKind, rangedAttackType, hitZone, distance, coverPenalty } =
        await c.req.json<{
            attackerId: string;
            targetId: string;
            maneuverId?: string | null;
            attackKind?: 'standard' | 'opportunity';
            rangedAttackType?: 'shooting' | 'thrown';
            hitZone?: HitZone | null;
            distance?: number | null;
            coverPenalty?: number;
        }>();
    return c.json(
        await combat.beginAttackAction(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            attackerId,
            targetId,
            maneuverId,
            attackKind,
            rangedAttackType,
            hitZone,
            distance,
            coverPenalty,
        })
    );
});

combatRoutes.get('/:sessionId/pending-attack', async c =>
    c.json(
        await combat.getPendingAttack(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            actionId: c.req.query('actionId'),
        })
    )
);

combatRoutes.get('/:sessionId/pending-attack/:actionId', async c =>
    c.json(
        await combat.getPendingAttack(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            actionId: c.req.param('actionId'),
        })
    )
);

combatRoutes.post('/:sessionId/pending-attack/:actionId/defense', async c => {
    const { decision, force } = await c.req.json<{ decision: DefenseChoice; force?: boolean }>();
    return c.json(
        await combat.resolvePendingAttack(c.get('ctx'), {
            actionId: c.req.param('actionId'),
            sessionId: c.req.param('sessionId'),
            decision,
            force,
        })
    );
});

combatRoutes.get('/:sessionId/combatants/:combatantId/actions', async c =>
    c.json(
        await combat.getCombatActionMenu(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            combatantId: c.req.param('combatantId'),
        })
    )
);

combatRoutes.post('/:sessionId/combatants/:combatantId/generic-action', async c => {
    const { description, freeAction } = await c.req.json<{ description: string; freeAction?: boolean }>();
    return c.json(
        await combat.recordGenericCombatAction(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            combatantId: c.req.param('combatantId'),
            description,
            freeAction,
        }),
        201
    );
});

combatRoutes.post('/:sessionId/combatants/:combatantId/resource', async c => {
    const { type, amount, reason } = await c.req.json<{ type: ResourceKey; amount: number; reason: string }>();
    return c.json(
        await combat.spendCombatResource(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            combatantId: c.req.param('combatantId'),
            type,
            amount,
            reason,
        })
    );
});

combatRoutes.post('/:sessionId/combatants/:combatantId/retrieve-weapon', async c => {
    const { weaponId, opponentId } = await c.req.json<{ weaponId: number; opponentId?: string | null }>();
    return c.json(
        await combat.retrieveDroppedWeapon(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            combatantId: c.req.param('combatantId'),
            weaponId,
            opponentId,
        })
    );
});

combatRoutes.post('/:sessionId/two-weapon-attack', async c => {
    const { attackerId, targetIds } = await c.req.json<{
        attackerId: string;
        targetIds: [string, string?];
    }>();
    return c.json(
        await combat.resolveTwoWeaponAttackAction(c.get('ctx'), {
            sessionId: c.req.param('sessionId'),
            attackerId,
            targetIds,
        })
    );
});

combatRoutes.post('/:sessionId/full-defense', async c => {
    const { combatantId } = await c.req.json<{ combatantId: string }>();
    return c.json(await combat.takeFullDefense(c.get('ctx'), { sessionId: c.req.param('sessionId'), combatantId }));
});

combatRoutes.post('/:sessionId/reload', async c => {
    const { combatantId } = await c.req.json<{ combatantId: string }>();
    return c.json(await combat.reloadAction(c.get('ctx'), { sessionId: c.req.param('sessionId'), combatantId }));
});

combatRoutes.post('/:sessionId/escape-grapple', async c => {
    const { combatantId } = await c.req.json<{ combatantId: string }>();
    return c.json(await combat.escapeGrapple(c.get('ctx'), { sessionId: c.req.param('sessionId'), combatantId }));
});

combatRoutes.post('/:sessionId/stand-up', async c => {
    const { combatantId } = await c.req.json<{ combatantId: string }>();
    return c.json(await combat.standUp(c.get('ctx'), { sessionId: c.req.param('sessionId'), combatantId }));
});

combatRoutes.post('/:sessionId/advance', async c =>
    c.json(await combat.advanceTurn(c.get('ctx'), c.req.param('sessionId')))
);

combatRoutes.post('/:sessionId/end', async c => {
    const { reason } = await c.req.json<{ reason?: string }>();
    return c.json(await combat.endCombatSession(c.get('ctx'), { sessionId: c.req.param('sessionId'), reason }));
});

combatRoutes.post('/:sessionId/park', async c =>
    c.json(await combat.parkCombat(c.get('ctx'), c.req.param('sessionId')))
);

combatRoutes.post('/:sessionId/resume', async c =>
    c.json(await combat.resumeCombat(c.get('ctx'), c.req.param('sessionId')))
);

combatRoutes.delete('/:sessionId', async c =>
    c.json(await combat.cancelCombat(c.get('ctx'), c.req.param('sessionId')))
);

// --- Combatant conditions (combatant-scoped) ---
combatRoutes.post('/combatants/:combatantId/conditions', async c => {
    const body = await c.req.json();
    return c.json(await combat.applyCondition(c.get('ctx'), { ...body, combatantId: c.req.param('combatantId') }), 201);
});

combatRoutes.get('/combatants/:combatantId/conditions', async c =>
    c.json(await combat.listConditions(c.get('ctx'), c.req.param('combatantId')))
);

combatRoutes.delete('/combatants/:combatantId/conditions/:type', async c =>
    c.json(
        await combat.removeCondition(c.get('ctx'), {
            combatantId: c.req.param('combatantId'),
            conditionType: c.req.param('type'),
        })
    )
);

combatRoutes.post('/combatants/:combatantId/conditions/furcht/resist', async c => {
    const { modifier } = await c.req.json<{ modifier?: number }>();
    return c.json(
        await combat.resistCondition(c.get('ctx'), {
            combatantId: c.req.param('combatantId'),
            conditionType: 'furcht',
            modifier,
        })
    );
});

// --- Binary statuses with optional DOT/penalty payloads ---
combatRoutes.post('/combatants/:combatantId/statuses', async c => {
    const body = await c.req.json();
    return c.json(await combat.applyStatus(c.get('ctx'), { ...body, combatantId: c.req.param('combatantId') }), 201);
});

combatRoutes.get('/combatants/:combatantId/statuses', async c =>
    c.json(await combat.listStatuses(c.get('ctx'), c.req.param('combatantId')))
);

combatRoutes.delete('/combatants/:combatantId/statuses/:type', async c =>
    c.json(
        await combat.removeStatus(c.get('ctx'), {
            combatantId: c.req.param('combatantId'),
            statusType: c.req.param('type'),
        })
    )
);

// --- Persistent buffs, debuffs, and stances ---
combatRoutes.post('/combatants/:combatantId/effects', async c => {
    const body = await c.req.json();
    return c.json(await combat.applyEffect(c.get('ctx'), { ...body, combatantId: c.req.param('combatantId') }), 201);
});

combatRoutes.get('/combatants/:combatantId/effects', async c =>
    c.json(await combat.listEffects(c.get('ctx'), c.req.param('combatantId')))
);

combatRoutes.delete('/combatants/:combatantId/effects/:type', async c =>
    c.json(
        await combat.removeEffect(c.get('ctx'), {
            combatantId: c.req.param('combatantId'),
            effectType: c.req.param('type'),
        })
    )
);
