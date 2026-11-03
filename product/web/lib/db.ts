import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';
import { SUPABASE_ROOT_CA } from './supabase-ca.ts';

let pool: Pool | null | undefined;

type Env = Readonly<Record<string, string | undefined>>;

/** The placeholder Supabase's Connect dialog puts where the password goes. */
export const PASSWORD_PLACEHOLDER = '[YOUR-PASSWORD]';

/** The database address isn't set up as runbook Part 10 describes. Its text never holds a value. */
export class DatabaseAddressError extends Error {}

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
 * The app's database address, from the values Supabase's dashboard shows (runbook Part 10):
 * `DATABASE_URL` is the "Transaction pooler" string copied as it is from the Connect dialog,
 * with Supabase's `[YOUR-PASSWORD]` placeholder still in it, and `SUPABASE_DB_PASSWORD` is
 * the database password. The password is filled in here, percent-encoded, so nobody ever
 * builds a connection string by hand. A complete address (no placeholder) is used as it is.
 * Null where the database isn't configured.
 */
export function databaseAddress(env: Env = process.env): string | null {
  const template = env.DATABASE_URL?.trim();
  if (!template) return null;
  if (!template.includes(PASSWORD_PLACEHOLDER)) return withoutTlsOptions(template);
  const password = env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new DatabaseAddressError(
      'DATABASE_URL has the password placeholder, but SUPABASE_DB_PASSWORD is not set',
    );
  }
  if (template.split(PASSWORD_PLACEHOLDER).length !== 2) {
    throw new DatabaseAddressError('DATABASE_URL must hold the password placeholder exactly once');
  }
  return withoutTlsOptions(template.replace(PASSWORD_PLACEHOLDER, encodeURIComponent(password)));
}

/**
 * The app's database pool (blueprint section 5): Supabase's pooler in transaction mode
 * (`DATABASE_URL`, port 6543), 2 connections per running instance, no named prepared
 * statements, idle connections closed after 20 seconds and replaced after 30 minutes, and
 * the server's certificate checked against Supabase's own certificate authority. On Vercel,
 * `attachDatabasePool` lets idle connections close cleanly before an instance is suspended.
 * Null where the database isn't configured. Throws DatabaseAddressError if it is set up
 * wrongly.
 */
export function database(): Pool | null {
  if (pool !== undefined) return pool;
  const address = databaseAddress();
  if (!address) {
    pool = null;
    return pool;
  }
  pool = new Pool({
    connectionString: address,
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
