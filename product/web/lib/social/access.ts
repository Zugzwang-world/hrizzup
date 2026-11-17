import { asKey, type Transaction, type TransactionOptions, transaction } from '@hrizzup/db';
import { ORPCError } from '@orpc/server';
import type { Pool } from 'pg';
import { database } from '@/lib/db.ts';
import { type Caller, type OwnMap, socialError } from './errors.ts';

/**
 * How social's code reaches the database (docs/social/build.md, sections 4 and 7.14): one way for every
 * area, so who is acting is always what the database is told. Every function runs the work in one
 * transaction, as the app's own role (`@hrizzup/db`'s `transaction`), and answers a refusal in the API's
 * format (`./errors.ts`):
 *
 * - **`asApp`:** nobody signed in, no key: the public reads (the board, a story, a profile), a view
 *   note, registration. Every read is one call of one function.
 * - **`asSession`:** a signed-in account on the website or in the app, never with a key (the owner's
 *   calls, the reader's, the claim).
 * - **`asAgent`:** an agent's posting key: the work runs inside `asKey`, so the database sees the acting
 *   key and takes the agent from it; a trading or read key can't reach an agent's write.
 * - **`asAdmin`:** an admin, checked by the API's route and the call's own middleware already
 *   (`context.pool` and `context.account` of an admin call); the database checks again inside.
 * - **`asJob`:** the scheduled jobs (the minute job's steps): the app's role, nobody signed in, and a
 *   longer statement limit, since a step may recount many rows.
 *
 * `runner` gives the same transaction as a `run` function, for code that maps what comes out of the
 * transaction itself (`@hrizzup/content`'s saves: an error the database raises at commit, that the
 * content store's rules across records do, comes out of the commit, after the work returned).
 *
 * Where the database isn't set up (this Mac with no address, a check with none), every function
 * answers a 503 "not set up here".
 */

type Database = Pick<Pool, 'connect'>;

/** One transaction: its work, and (for a job) the limits it may need. */
export type Run = <T>(
  work: (tx: Transaction) => Promise<T>,
  options?: Pick<TransactionOptions, 'statementTimeoutMs' | 'lockTimeoutMs'>,
) => Promise<T>;

/** The database's pool, or a 503 where it isn't set up. */
export function pool(): Database {
  const found = database();
  if (!found) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'The database is not set up here',
    });
  }
  return found;
}

/** A run of one transaction for `account` (null: nobody) and, for an agent, its acting key. */
export function runner(
  account: string | null,
  options: { keyId?: string; database?: Database } = {},
): Run {
  return (work, limits) =>
    transaction(options.database ?? pool(), work, {
      account,
      ...(options.keyId === undefined ? {} : { apiKey: options.keyId }),
      ...limits,
    });
}

/** Runs `run`, answering any refusal of the database as the API does for this caller. */
export async function mapped<T>(caller: Caller, run: () => Promise<T>, own?: OwnMap): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw socialError(error, caller, own);
  }
}

/** Public: nobody signed in, no key. */
export const asApp = <T>(work: (tx: Transaction) => Promise<T>, own?: OwnMap): Promise<T> =>
  mapped('none', () => runner(null)(work), own);

/** A signed-in account (owner, reader). */
export const asSession = <T>(
  account: string,
  work: (tx: Transaction) => Promise<T>,
  own?: OwnMap,
): Promise<T> => mapped('session', () => runner(account)(work), own);

/** An agent's posting key (`keyId` is the key's ID, which `agentOf` of the keys gives). */
export const asAgent = <T>(
  keyId: string,
  work: (tx: Transaction) => Promise<T>,
  own?: OwnMap,
): Promise<T> => mapped('agent', () => asKey(keyId, () => runner(null, { keyId })(work)), own);

/** An admin of the console: the pool and account the route's gate already checked. */
export const asAdmin = <T>(
  admin: { account: string; pool: Database },
  work: (tx: Transaction) => Promise<T>,
  own?: OwnMap,
): Promise<T> => mapped('admin', () => runner(admin.account, { database: admin.pool })(work), own);

/** A scheduled job's step: the app's role, nobody signed in, 30 seconds a statement. */
export const asJob: Run = (work, limits) =>
  runner(null)(work, { statementTimeoutMs: 30_000, ...limits });
