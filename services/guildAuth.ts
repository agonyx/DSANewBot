import { httpError } from '../db/operations/errors';
import type { Ctx } from './_ctx';

/** Enforce both DM authorization and a concrete guild boundary. */
export function requireDmGuild(ctx: Ctx, guildId: string): string {
    const normalizedGuildId = guildId?.trim();
    if (!normalizedGuildId) throw httpError(400, 'This action can only be used in a Discord server');
    if (ctx.role !== 'DM' && !ctx.dmGuildIds?.includes(normalizedGuildId)) {
        throw httpError(403, 'This action requires Manage Server permission');
    }
    return normalizedGuildId;
}
