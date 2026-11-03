import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';
import { SUPABASE_ROOT_CA } from './supabase-ca.ts';

let pool: Pool | null | undefined;

/**
 * The connection string without its TLS options: they would replace the full certificate
 * check below, so they are removed and the check is always set here.
 */
export function withoutTlsOptions(connectionString: string): string {
  const url = new URL(connectionString);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl')) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * The app's database pool (blueprint section 5): Supabase's pooler in transaction mode
 * (`DATABASE_URL`, port 6543), 2 connections per running instance, no named prepared
 * statements, idle connections closed after 20 seconds and replaced after 30 minutes, and
 * the server's certificate checked against Supabase's own certificate authority. On Vercel,
 * `attachDatabasePool` lets idle connections close cleanly before an instance is suspended.
 * Null where the database isn't configured (production, until Part 10).
 */
export function database(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    pool = null;
    return pool;
  }
  pool = new Pool({
    connectionString: withoutTlsOptions(url),
    ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
    max: 2,
    idleTimeoutMillis: 20_000,
    maxLifetimeSeconds: 30 * 60,
    connectionTimeoutMillis: 10_000,
    application_name: 'hrizzup-web',
  });
  // An idle connection can drop (the pooler restarting, a network blip). pg reports that as
  // an 'error' event; with no listener, Node would treat it as a crash. The broken
  // connection is already discarded, and the next query opens a new one. Nothing is
  // logged, because the error's text could include connection details.
  pool.on('error', () => {});
  attachDatabasePool(pool);
  return pool;
}
