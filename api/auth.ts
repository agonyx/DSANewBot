import { Hono } from 'hono';
import type { Context } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { Ctx } from '../services/_ctx';
import { HttpError } from '../db/operations/errors';

const DISCORD_CLIENT_ID = process.env.CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || '';

export const authRoutes = new Hono();

/** Step 1 — redirect the website user to Discord's OAuth2 authorize page. */
authRoutes.get('/discord', c => {
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', DISCORD_CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    return c.redirect(url.toString());
});

/** Step 2 — Discord redirects back here with ?code; exchange it for a JWT keyed to discord_id. */
authRoutes.get('/callback', async c => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'missing code' }, 400);
    if (!DISCORD_CLIENT_SECRET || !JWT_SECRET || !REDIRECT_URI) {
        return c.json(
            { error: 'OAuth not configured (set DISCORD_CLIENT_SECRET, JWT_SECRET, OAUTH_REDIRECT_URI)' },
            500
        );
    }

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        }),
    });
    if (!tokenRes.ok) return c.json({ error: 'Discord token exchange failed' }, 502);
    const tokenBody = (await tokenRes.json()) as { access_token?: string };
    if (!tokenBody.access_token) return c.json({ error: 'no access_token from Discord' }, 502);

    const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!userRes.ok) return c.json({ error: 'Discord user fetch failed' }, 502);
    const user = (await userRes.json()) as { id?: string };
    if (!user.id) return c.json({ error: 'no user id from Discord' }, 502);

    const guildRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!guildRes.ok) return c.json({ error: 'Discord guild fetch failed' }, 502);
    const guilds = (await guildRes.json()) as Array<{ id?: string; permissions?: string }>;
    const dmGuildIds = guilds
        .filter(guild => {
            const permissions = BigInt(guild.permissions || '0');
            return (permissions & 0x8n) !== 0n || (permissions & 0x20n) !== 0n;
        })
        .map(guild => guild.id)
        .filter((id): id is string => Boolean(id));

    const token = await sign({ discordId: user.id, dmGuildIds }, JWT_SECRET, 'HS256');
    return c.json({ token, discordId: user.id, dmGuildIds });
});

/**
 * Default ctx resolver for protected routes: pull a Bearer JWT from the
 * Authorization header and verify it. Throws HttpError(401) on failure.
 */
export async function resolveJwtCtx(c: Context): Promise<Ctx> {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Missing bearer token');
    try {
        const payload = (await verify(token, JWT_SECRET, 'HS256')) as { discordId?: string; dmGuildIds?: string[] };
        if (!payload.discordId) throw new HttpError(401, 'Invalid token payload');
        return {
            discordId: payload.discordId,
            dmGuildIds: Array.isArray(payload.dmGuildIds)
                ? payload.dmGuildIds.filter(id => typeof id === 'string')
                : [],
        };
    } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(401, 'Invalid or expired token');
    }
}
