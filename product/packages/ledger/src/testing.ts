import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';
import { decimal, type Micros, micros } from './decimal.ts';
import type { TradeRequest } from './plan.ts';
import { type TradeResult, trade } from './trade.ts';

/**
 * What the database tests share (the Database check: a fresh database built from the
 * migrations). The test's own setup runs as the owner, the way migrations and step 3.1's signup
 * or step 1.7c's console will; every trade goes through `trade()`, as the app's own role.
 */

/** The local database's address, from scripts/test-db.ts. */
export function databaseUrl(): string {
  const url = process.env.LEDGER_DATABASE_URL;
  if (!url) throw new Error('LEDGER_DATABASE_URL is not set: run `pnpm test:db`');
  return url;
}

/** A pool of connections as the owner (postgres). `max` sets how many trades can run at once. */
export function connect(max = 4): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl(), max });
  pool.on('error', () => {});
  return pool;
}

/** A person with a sign-in account and a starting balance from the house. */
export type Person = { userId: string; accountId: string };

export async function person(owner: pg.Pool, starting: string): Promise<Person> {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@ledger.test`,
  ]);
  const { rows } = await owner.query<{ id: string }>('select ledger.open_account($1, $2) as id', [
    userId,
    starting,
  ]);
  return { userId, accountId: (rows[0] as { id: string }).id };
}

/** A test market, seeded by the house, closing a day from now unless told otherwise. */
export async function market(
  owner: pg.Pool,
  options: { probability?: string; seed?: string; closesAt?: Date } = {},
): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    'select markets.create_market($1, $2, $3) as id',
    [
      options.closesAt ?? new Date(Date.now() + 86_400_000),
      options.probability ?? '0.5',
      options.seed ?? '1000',
    ],
  );
  return (rows[0] as { id: string }).id;
}

/** Settles a market (owner only until step 1.7c). */
export async function settle(
  owner: pg.Pool,
  marketId: string,
  resolution: 'YES' | 'NO' | 'MKT' | 'CANCEL',
  probability?: string,
) {
  const { rows } = await owner.query<{ result: Record<string, unknown> }>(
    'select markets.settle($1, $2, $3) as result',
    [marketId, resolution, probability ?? null],
  );
  return (rows[0] as { result: Record<string, unknown> }).result;
}

/** Anything wrong with the books (ledger.problems()): must always be empty. */
export async function problems(owner: pg.Pool): Promise<string[]> {
  const { rows } = await owner.query<{ problem: string }>('select problem from ledger.problems()');
  return rows.map((row) => row.problem);
}

/** Fails the test if the books have any problem. */
export async function expectBooksBalance(owner: pg.Pool, when = '') {
  expect(await problems(owner), `the books ${when}`).toEqual([]);
}

export async function balance(owner: pg.Pool, accountId: string): Promise<Micros> {
  const { rows } = await owner.query<{ balance: string }>(
    'select balance::text from ledger.accounts where id = $1',
    [accountId],
  );
  return micros((rows[0] as { balance: string }).balance);
}

export async function position(
  owner: pg.Pool,
  marketId: string,
  accountId: string,
): Promise<{ yes: Micros; no: Micros }> {
  const { rows } = await owner.query<{ yes: string; no: string }>(
    `select yes_shares::text as yes, no_shares::text as no
     from markets.positions where market_id = $1 and account_id = $2`,
    [marketId, accountId],
  );
  const row = rows[0];
  return row ? { yes: micros(row.yes), no: micros(row.no) } : { yes: 0n, no: 0n };
}

/** A buy as the person, with a fresh request ID. */
export function buy(
  pool: pg.Pool,
  who: Person,
  marketId: string,
  outcome: 'YES' | 'NO',
  amount: Micros | string,
  extra: { limitProb?: string; expiresAt?: Date; requestId?: string } = {},
): Promise<TradeResult> {
  const request: TradeRequest = {
    action: 'buy',
    requestId: extra.requestId ?? randomUUID(),
    marketId,
    outcome,
    amount: typeof amount === 'string' ? amount : decimal(amount),
    ...(extra.limitProb === undefined ? {} : { limitProb: extra.limitProb }),
    ...(extra.expiresAt === undefined ? {} : { expiresAt: extra.expiresAt }),
  };
  return trade(pool, who.userId, request);
}

/** A sale as the person, with a fresh request ID. */
export function sell(
  pool: pg.Pool,
  who: Person,
  marketId: string,
  outcome: 'YES' | 'NO',
  shares: Micros | string,
): Promise<TradeResult> {
  return trade(pool, who.userId, {
    action: 'sell',
    requestId: randomUUID(),
    marketId,
    outcome,
    shares: typeof shares === 'string' ? shares : decimal(shares),
  });
}

/** Waits until `when` has passed, by the database's clock as well as this one. */
export async function waitUntil(when: Date, margin = 150): Promise<void> {
  const wait = when.getTime() + margin - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** Narrows a result to a trade that went through. */
export function traded(result: TradeResult) {
  if (result.status === 'refused' || result.status === 'cancelled') {
    throw new Error(`Expected a trade, got ${JSON.stringify(result)}`);
  }
  return result;
}
