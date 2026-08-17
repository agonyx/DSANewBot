/**
 * Database client — postgres.js pool wrapped by Drizzle ORM.
 *
 * Replaces utils/supabaseClient.js as the bot's single data-access entry point.
 * Requires DATABASE_URL (drop-in for the old SUPABASE_URL/SUPABASE_ANON_KEY).
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { createLogger } from '../utils/logger';

const log = createLogger('db');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    log.fatal('DATABASE_URL environment variable must be set');
    process.exit(1);
}

// Single-process bot — a modest pool is plenty.
export const pool = postgres(DATABASE_URL, { max: 10 });

export const db = drizzle(pool, { schema });

/** Drain the connection pool on shutdown. */
export async function closeDb(): Promise<void> {
    await pool.end();
}

// Re-export the Edge Function bridge so call sites can import { db, callEdgeFunction } from '../db'.
export { callEdgeFunction } from './edgeBridge';
