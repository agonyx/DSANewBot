import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Hono `onError` handler. Maps any error carrying a numeric `.status` (i.e.
 * HttpError thrown by services) to a JSON response with that status; everything
 * else → 500. Registered via `app.onError(apiOnError)`.
 *
 * (Hono routes uncaught errors through onError, not through middleware try/catch,
 * so this is the correct seam — and duck-typing on `.status` sidesteps the
 * dual-package `instanceof` hazard under tsx.)
 */
export function apiOnError(err: Error, c: Context) {
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number') {
        const e = err as Error & { data?: unknown };
        return c.json(
            { error: e.message, ...(e.data ? { data: e.data } : {}) },
            status as ContentfulStatusCode
        );
    }
    console.error('[api] unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
}
