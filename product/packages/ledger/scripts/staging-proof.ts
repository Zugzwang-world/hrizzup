/**
 * PLAN.md step 1.7b's done-test on staging, leaving its tables empty: inside one transaction on
 * staging's database it makes a throwaway person and a test market (as the owner, the way 3.1's
 * signup and 1.7c's console will), switches to the app's own role as that person, runs a real
 * trade through markets.begin_trade, Manifold's maths and markets.apply_trade, checks the balance,
 * the position, the pool and the books changed together, then rolls everything back.
 *
 *   infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \
 *     node product/packages/ledger/scripts/staging-proof.ts
 *
 * Reads DATABASE_ADDRESS (the session pooler, filled in by database_url.py) and checks the
 * server's certificate against Supabase's own authority. Prints no value of any key.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { type MarketState, paramsOf, planTrade } from '../src/plan.ts';

const address = process.env.DATABASE_ADDRESS;
if (!address) throw new Error('DATABASE_ADDRESS is not set: run through database_url.py');
const ca = readFileSync(
  new URL('../../../../infra/supabase/supabase-root-2021-ca.crt', import.meta.url),
  'utf8',
);
const url = new URL(address);
for (const key of [...url.searchParams.keys()])
  if (key.startsWith('ssl')) url.searchParams.delete(key);

// A local database (a dry run in this worktree's slot) has no certificate to check.
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: local ? false : { ca, rejectUnauthorized: true },
});
await client.connect();
const one = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
  (await client.query<T>(text, values)).rows[0] as T;

try {
  await client.query('begin');
  const before = await one<{ accounts: number; moves: number; markets: number }>(
    `select (select count(*)::int from ledger.accounts) as accounts,
            (select count(*)::int from ledger.moves) as moves,
            (select count(*)::int from markets.markets) as markets`,
  );
  console.log('Before, on staging:', before);

  const userId = randomUUID();
  await client.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@ledger-proof.invalid`,
  ]);
  const { account } = await one<{ account: string }>(
    'select ledger.open_account($1, 500) as account',
    [userId],
  );
  const { market } = await one<{ market: string }>(
    `select markets.create_market(now() + interval '1 day', 0.5, 1000) as market`,
  );

  // The trade, as the app's own role with this person signed in: what @hrizzup/db does.
  await client.query(
    `select set_config('role', 'hrizzup_app', true),
            set_config('request.jwt.claims', $1, true),
            set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify({ sub: userId, role: 'authenticated' }), userId],
  );
  const request = {
    action: 'buy' as const,
    requestId: randomUUID(),
    marketId: market,
    outcome: 'YES' as const,
    amount: '100',
  };
  const { state } = await one<{ state: MarketState }>(
    'select markets.begin_trade($1, $2, $3, $4) as state',
    [request.requestId, market, 'buy', paramsOf(request)],
  );
  const plan = planTrade(request, state, randomUUID());
  const { result } = await one<{ result: Record<string, unknown> }>(
    'select markets.apply_trade($1) as result',
    [plan],
  );
  await client.query(`select set_config('role', 'none', true)`);
  console.log('The trade, as the app role:', result);

  const after = await one<{
    balance: string;
    yes: string;
    pool_yes: string;
    pool_no: string;
    problems: number;
  }>(
    `select (select balance::text from ledger.accounts where id = $1) as balance,
            (select yes_shares::text from markets.positions where market_id = $2 and account_id = $1) as yes,
            (select pool_yes::text from markets.markets where id = $2) as pool_yes,
            (select pool_no::text from markets.markets where id = $2) as pool_no,
            (select count(*)::int from ledger.problems()) as problems`,
    [account, market],
  );
  console.log('After the trade, in the same transaction:', after);
  const ok =
    after.balance === '400.000000' &&
    after.yes === result.shares &&
    after.pool_no === '1100.000000' &&
    after.problems === 0;
  await client.query('set constraints all immediate'); // The backing check, as at commit
  console.log(ok ? 'PROOF: the trade changed balance, position and pool in one step' : 'FAILED');
  if (!ok) process.exitCode = 1;
} finally {
  await client.query('rollback');
  const left = await one<{ accounts: number; moves: number; markets: number }>(
    `select (select count(*)::int from ledger.accounts) as accounts,
            (select count(*)::int from ledger.moves) as moves,
            (select count(*)::int from markets.markets) as markets`,
  );
  console.log('After rolling back, on staging:', left);
  await client.end();
}
