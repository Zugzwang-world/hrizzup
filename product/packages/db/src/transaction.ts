import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * The server's one way into the database (blueprint section 5, "The app's own role"): every
 * call is one transaction, run as the app's own role with the signed-in account set, so the
 * database itself knows who is acting and refuses anything the role isn't granted.
 *
 * At the start of each transaction the helper switches to `hrizzup_app` (`SET LOCAL ROLE`,
 * which lasts only until the transaction ends, so it works through Supabase's pooler in
 * transaction mode) and sets the signed-in account the way Supabase's own Data API does
 * (`request.jwt.claims`, which `auth.uid()` reads). It also gives every statement time limits,
 * so a busy market answers "try again" instead of hanging, and tries the whole transaction
 * again when the database asks it to (a lock wait that ran out, a deadlock it broke, or a
 * serialization failure), so the work it runs must be safe to repeat: a trade is, because each
 * trade request carries its own ID.
 */

/** The app's own role: it owns nothing and may only call the functions granted to it. */
export const APP_ROLE = 'hrizzup_app';

/** What a transaction's work runs its statements on. */
export type Transaction = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

export type TransactionOptions = {
  /** The signed-in account (its Supabase user ID), or null when nobody is signed in. */
  account: string | null;
  /** Attempts in all, when the database asks to try again (default 3). */
  attempts?: number;
  /** How long a statement may wait for a lock before giving up (default 2 seconds). */
  lockTimeoutMs?: number;
  /** How long a statement may run (default 10 seconds). */
  statementTimeoutMs?: number;
};

/** The database stayed busy through every attempt: the caller may answer "try again". */
export class DatabaseBusyError extends Error {
  constructor(options?: ErrorOptions) {
    super('The database is busy: try again', options);
    this.name = 'DatabaseBusyError';
  }
}

/** A Supabase user ID: a UUID, checked before it reaches the database. */
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The errors after which the whole transaction is tried again: serialization_failure,
 * deadlock_detected and lock_not_available (a lock wait that reached its time limit).
 */
const TRY_AGAIN = new Set(['40001', '40P01', '55P03']);

/** The database's error code, when an error carries one. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** How long to wait before attempt `attempt` (2, 3, ...): doubling from 25 ms, with jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 25 * 2 ** (attempt - 2);
  return Math.round(base / 2 + random() * base);
}

/** The claims Supabase's Data API would set for this account (auth.uid() reads `sub`). */
export function claimsFor(account: string | null): string {
  if (account === null) return JSON.stringify({ role: 'anon' });
  if (!USER_ID.test(account)) throw new TypeError('The signed-in account must be a user ID');
  return JSON.stringify({ sub: account.toLowerCase(), role: 'authenticated' });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` in one transaction, as the app's own role, with `options.account` signed in.
 * Commits when `work` resolves, rolls back when it throws. Tries again, up to
 * `options.attempts` times in all, when the database asks to; then throws DatabaseBusyError.
 */
export async function transaction<T>(
  pool: Pick<Pool, 'connect'>,
  work: (tx: Transaction) => Promise<T>,
  options: TransactionOptions,
): Promise<T> {
  const claims = claimsFor(options.account);
  const attempts = options.attempts ?? 3;
  const settings = [
    APP_ROLE,
    claims,
    options.account?.toLowerCase() ?? '',
    `${options.lockTimeoutMs ?? 2_000}ms`,
    `${options.statementTimeoutMs ?? 10_000}ms`,
  ];
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1) await sleep(backoffMs(attempt));
    const client: PoolClient = await pool.connect();
    let broken = false;
    try {
      await client.query('begin');
      // set_config(…, true) is SET LOCAL: it ends with the transaction.
      await client.query(
        `select set_config('role', $1, true),
                set_config('request.jwt.claims', $2, true),
                set_config('request.jwt.claim.sub', $3, true),
                set_config('lock_timeout', $4, true),
                set_config('statement_timeout', $5, true)`,
        settings,
      );
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        broken = true; // The connection is gone; it's discarded below.
      }
      const code = errorCode(error);
      if (code === undefined || !TRY_AGAIN.has(code)) throw error;
      if (attempt >= attempts) throw new DatabaseBusyError({ cause: error });
    } finally {
      client.release(broken);
    }
  }
}
