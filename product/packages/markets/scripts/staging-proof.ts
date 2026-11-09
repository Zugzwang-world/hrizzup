/**
 * PLAN.md step 1.7c's done-test on staging, with a real bet in it. The console's journeys run
 * create, open, close and settle on staging, but nothing can place a bet through the typed API
 * until step 1.7d. This script puts one in the middle, and checks the payouts with a position to
 * pay. It leaves a settled test market on staging, as the journeys do.
 *
 *   infra/doppler/run stg -- python3 infra/supabase/database_url.py run session -- \
 *     node product/packages/markets/scripts/staging-proof.ts
 *
 * As the market console's admin test account, through the typed API on staging.hrizzup.com
 * (a session of its own, from a one-time sign-in through staging's server key, ended at the
 * end): it creates a test market and opens it. As the screen
 * check's Chromium test account, through the ledger's own trade() as the app's own role (the
 * owner gives that account its play money the first time, as step 3.1's signup will): it buys
 * Yes. Back as the admin, it closes the market and settles it Yes, with its evidence. Then it
 * checks:
 * - the trader got Ṁ1 a Yes share;
 * - what people got plus what the house got comes to all the market held;
 * - the log shows the four steps, by the admin;
 * - the books on staging have no problem (ledger.problems()).
 *
 * Reads DATABASE_ADDRESS (the session pooler, filled in by database_url.py), checking the
 * server's certificate against Supabase's own authority, and SUPABASE_URL,
 * SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (staging's only). Prints no value of any key
 * or token.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trade } from '@hrizzup/ledger';
import pg from 'pg';

const SITE = 'https://staging.hrizzup.com';
const TRADER = 'delivered+screen-check-chromium@resend.dev';

const ADMIN = 'delivered+market-admin@resend.dev';
const STAGING = 'https://mlccgqxtqmllwbyjfzzm.supabase.co';
const supabase = process.env.SUPABASE_URL?.replace(/\/$/, '');
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (supabase !== STAGING || !publishable || !secret) {
  throw new Error("Run with staging's keys (Doppler stg); this refuses any other project");
}
const address = process.env.DATABASE_ADDRESS;
if (!address) throw new Error('DATABASE_ADDRESS is not set: run through database_url.py');

const ca = readFileSync(
  new URL('../../../../infra/supabase/supabase-root-2021-ca.crt', import.meta.url),
  'utf8',
);
const url = new URL(address);
for (const key of [...url.searchParams.keys()])
  if (key.startsWith('ssl')) url.searchParams.delete(key);
const owner = new pg.Pool({
  connectionString: url.toString(),
  ssl: { ca, rejectUnauthorized: true },
  max: 2,
});
owner.on('error', () => {});

/** A session for the admin test account, from a one-time sign-in no email carries. */
async function adminSession(): Promise<string> {
  const link = await fetch(`${STAGING}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: secret as string,
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: ADMIN }),
  });
  const made = (await link.json()) as {
    hashed_token?: string;
    properties?: { hashed_token?: string };
  };
  const hash = made.hashed_token ?? made.properties?.hashed_token;
  if (!link.ok || !hash) throw new Error(`No one-time sign-in for ${ADMIN} (${link.status})`);
  const verified = await fetch(`${STAGING}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: publishable as string, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hash }),
  });
  const session = (await verified.json()) as { access_token?: string };
  if (!verified.ok || !session.access_token)
    throw new Error(`Staging refused the sign-in (${verified.status})`);
  return session.access_token;
}

const token = await adminSession();

/** One of the console's calls on staging, as the admin. */
async function console_(path: string, body?: unknown) {
  const response = await fetch(`${SITE}/api/v1/admin/markets${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const answer = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path || 'create'}: ${response.status} ${answer.message}`);
  return answer;
}

/** A version 7 UUID, as the console's form makes one. */
function newId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const time = Date.now().toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const micros = (text: string) => {
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return text.startsWith('-') ? -value : value;
};

try {
  const { rows: traders } = await owner.query<{ id: string }>(
    'select id from auth.users where email = $1',
    [TRADER],
  );
  const trader = traders[0]?.id;
  if (!trader) throw new Error(`${TRADER} doesn't exist on staging`);
  const { rows: accounts } = await owner.query<{ id: string; balance: string }>(
    `select id, balance::text from ledger.accounts where kind = 'person' and user_id = $1`,
    [trader],
  );
  let account = accounts[0];
  if (!account) {
    const { rows } = await owner.query<{ id: string }>(
      'select ledger.open_account($1, 1000) as id',
      [trader],
    );
    account = { id: (rows[0] as { id: string }).id, balance: '1000.000000' };
    console.log('The trader has play money from the house: Ṁ1,000 (the first time only)');
  }
  const before = micros(account.balance);

  const id = newId();
  await console_('', {
    id,
    question: `Staging proof (${new Date().toISOString().slice(0, 16)}): will the test desk record event A?`,
    categories: ['general'],
    rules:
      "A test market for step 1.7c's done-test on staging, with one bet in it.\nYes wins if the test desk records event A.",
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await console_(`/${id}/open`, {});
  console.log(`Market ${id}: created and opened by the admin, through the console's calls`);

  const bought = await trade(owner, trader, {
    action: 'buy',
    requestId: randomUUID(),
    marketId: id,
    outcome: 'YES',
    amount: '100',
  });
  if (bought.status !== 'filled')
    throw new Error(`The bet wasn't filled: ${JSON.stringify(bought)}`);
  console.log(`The trader bet Ṁ100 on Yes and got ${bought.shares} Yes shares`);

  const closed = await console_(`/${id}/close`, {});
  const settled = await console_(`/${id}/settle`, {
    outcome: 'yes',
    evidence: "The test desk recorded event A (step 1.7c's done-test on staging).",
  });
  const log = settled.log as {
    action: string;
    by: { email: string };
    settlement: Record<string, string> | null;
  }[];
  const sums = log.at(-1)?.settlement ?? {};
  const paid = micros(sums.paidToPeople ?? '0');
  const house = micros(sums.toHouse ?? '0');
  const held = micros(String(closed.held));
  const { rows: after } = await owner.query<{ balance: string }>(
    'select balance::text from ledger.accounts where id = $1',
    [account.id],
  );
  const now = micros((after[0] as { balance: string }).balance);
  const { rows: problems } = await owner.query('select problem from ledger.problems()');

  const checks: [string, boolean][] = [
    [
      'it is settled Yes, holding nothing',
      settled.state === 'settled' && settled.held === '0.000000',
    ],
    [
      'the log shows created, opened, closed, settled',
      log.map((l) => l.action).join() === 'create,open,close,settle',
    ],
    [
      'each step by the admin',
      log.every((l) => l.by.email === 'delivered+market-admin@resend.dev'),
    ],
    ['the trader got Ṁ1 a Yes share', now === before - micros('100') + micros(bought.shares)],
    ['people and the house got all the market held', paid + house === held],
    ['the books on staging have no problem', problems.length === 0],
  ];
  console.log(
    `Paid: Ṁ${sums.paidToPeople} to ${sums.people} person, Ṁ${sums.toHouse} to the house; the market held Ṁ${closed.held}`,
  );
  for (const [check, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${check}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  else console.log(`PROOF: market ${id}, settled by hand in the console's calls, adds up`);
} finally {
  // This session only (other runs' sessions of the same account stay signed in).
  await fetch(`${STAGING}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: { apikey: publishable, authorization: `Bearer ${token}` },
  });
  await owner.end();
}
