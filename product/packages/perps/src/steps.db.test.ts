import { randomUUID } from 'node:crypto';
import { contract } from '@hrizzup/api';
import { micros } from '@hrizzup/ledger';
import { STAND_IN_PRICE, standInPrice } from '@hrizzup/market-engine';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPerp, setPerpMode } from './console.ts';
import { runJob } from './jobs.ts';
import type { StepRequest } from './plan.ts';
import { OWN_PRICE_WAIT_MS, PerpNotSetUpError, type PriceSource, runStep } from './step.ts';
import {
  closePerp,
  listedPerps,
  openPerp,
  PerpTradingError,
  perpDetails,
  perpPositions,
} from './trading.ts';

/**
 * The perp's steps against a real database built from the migrations (the Database check), as the
 * app's own role, with the database's own clock: opening, adding, closing part, flipping and
 * closing; a retried request answered with its first answer and never traded twice, even sent twice
 * at once; the books refusing what can't trade and storing the refusal; one price each 5-second step
 * however many ticks run at once; a 10-times long liquidated when its test perp's seeded price falls
 * past its liquidation price, and a short closed at a profit; funding once a period, from the crowded
 * side to the other; the jobs touching only perps that are switched on and hold a position; and the
 * calls everyone uses (the price, opening and closing at the next new price, the person's positions),
 * each answer the contract's own shape. After each: every person's balance and the perp's pools to the
 * exact decimal, and the whole books with no problem.
 */

const url = process.env.PERPS_DATABASE_URL;
if (!url) throw new Error('PERPS_DATABASE_URL is not set: run `pnpm test:db`');

const BITCOIN = '01a1c501-ec40-78f6-87b6-3fb041143421';
/** The environment's seed for the listed perp, in these tests only (staging's lives in Doppler). */
const SOURCE: PriceSource = { seed: 'a1b2c3d4e5f60718' };
const STEP = STAND_IN_PRICE.intervalMs;

let owner: pg.Pool;
let app: pg.Pool;
const ADMIN = randomUUID();

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: url, max: 4 });
  app = new pg.Pool({ connectionString: url, max: 12 });
  owner.on('error', () => {});
  app.on('error', () => {});
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    ADMIN,
    `${ADMIN}@perps-steps.test`,
  ]);
  await owner.query(`insert into private.admins (user_id, note) values ($1, 'A test admin')`, [
    ADMIN,
  ]);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A new record ID: a version 7 UUID, as the agreement asks. */
function newId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const time = Date.now().toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const randomSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const SETTINGS = {
  maxLeverage: '10',
  takerFeeBps: '10',
  takerFeeImpact: '0',
  fundingPeriodMs: '3600000',
  fundingSensitivity: '1',
  maxFundingRate: '0.0001',
  maxPriceAgeMs: '120000',
  subsidyLong: '1000',
  subsidyShort: '1000',
};

type Walk = { seed: string; origin: number; startPrice: number; annualVolatility: number };

/** A test perp of this test's own, switched on: its own seed and walk, Ṁ1,000 in each pool. */
async function testPerp(
  options: { seed?: string; volatility?: number; origin?: number; fundingFrom?: string } = {},
): Promise<{ id: string; walk: Walk }> {
  const id = newId();
  const walk: Walk = {
    seed: options.seed ?? randomSeed(),
    origin: options.origin ?? Date.now() - 60_000,
    startPrice: 100,
    annualVolatility: options.volatility ?? 1,
  };
  await createTestPerp(app, ADMIN, {
    id,
    name: 'A database test’s own perp',
    seed: walk.seed,
    standIn: {
      origin: new Date(walk.origin).toISOString(),
      startPrice: String(walk.startPrice),
      volatility: String(walk.annualVolatility),
    },
    settings: SETTINGS,
    ...(options.fundingFrom === undefined ? {} : { fundingFrom: options.fundingFrom }),
    reason: 'A database test',
  });
  await setPerpMode(app, ADMIN, { id, mode: 'enabled', reason: 'The test trades it' });
  return { id, walk };
}

const priceOf = (walk: Walk, moment: number) => standInPrice(walk.seed, moment, walk);
/** The walk's step a moment falls in. */
const stepOf = (walk: Walk, moment: number) => Math.floor((moment - walk.origin) / STEP);
const stepStart = (walk: Walk, step: number) => walk.origin + step * STEP;

/** Someone signed in with this much play money. */
async function person(starting = '1000'): Promise<string> {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@perps-steps.test`,
  ]);
  await owner.query('select ledger.open_account($1, $2)', [userId, starting]);
  return userId;
}

/** Placed six seconds ago, so this moment's 5-second price was published after it: no wait. */
const placedAt = () => new Date(Date.now() - 6_000).toISOString();

type Opening = Extract<StepRequest, { action: 'open' }>;
type Closing = Extract<StepRequest, { action: 'close' }>;

function opening(
  direction: 'long' | 'short',
  margin: string,
  leverage: string,
  requestId: string = randomUUID(),
): Opening {
  return {
    action: 'open',
    requestId,
    params: { direction, margin, leverage },
    placedAt: placedAt(),
  };
}

/** Closing all, or a share sized on the position's size as last seen (the engine asks for it). */
function closing(
  fraction: string,
  expectedSize?: string,
  requestId: string = randomUUID(),
): Closing {
  return {
    action: 'close',
    requestId,
    params: { fraction, ...(expectedSize === undefined ? {} : { expectedSize }) },
    placedAt: placedAt(),
  };
}

/** What the books store as a trade's answer. */
type Answer = {
  status: 'opened' | 'added' | 'closed' | 'refused';
  price: string;
  price_at: string;
  placed_at: string;
  margin: string;
  fee: string;
  payout: string;
  balance: string;
  position: {
    id: string;
    direction: 'long' | 'short';
    size: string;
    costBasis: string;
    leverage: string;
    liquidationPrice: string;
  } | null;
  refusal?: { code: string; message: string };
};

async function trade(userId: string, perpId: string, request: StepRequest): Promise<Answer> {
  const answer = await runStep(app, userId, perpId, request, SOURCE);
  if (answer.kind !== 'applied') throw new Error(`The step answered ${answer.kind}`);
  return answer.result as unknown as Answer;
}

async function problems(): Promise<string[]> {
  const { rows } = await owner.query<{ problem: string }>('select problem from ledger.problems()');
  return rows.map((row) => row.problem);
}

/**
 * The perp's books to the exact decimal: each person's balance is what they started with, less
 * what they put in (margins and fees), plus what they were paid, as the perp's events say; the
 * pools hold the house's subsidy plus everything put in, less everything paid out (funding and
 * liquidations move money only between the pools); and the whole books have no problem.
 */
async function booksAddUp(perpId: string, people: Map<string, string>) {
  const { rows } = await owner.query<{ pools: string; seeded: string; flows: string }>(
    `select (l.balance + s.balance)::text as pools,
            (select coalesce(sum(m.amount), 0) from ledger.moves m
             join ledger.entries e on e.id = m.entry_id
             where e.perp_id = p.id and e.kind = 'perp_seed')::text as seeded,
            (select coalesce(sum(x.margin + x.fee - x.payout), 0) from perps.events x
             where x.perp_id = p.id)::text as flows
     from perps.perps p
     join ledger.accounts l on l.id = p.long_account_id
     join ledger.accounts s on s.id = p.short_account_id
     where p.id = $1`,
    [perpId],
  );
  const books = rows[0];
  if (!books) throw new Error('No such perp');
  expect(micros(books.pools), 'the pools').toBe(micros(books.seeded) + micros(books.flows));
  for (const [userId, starting] of people) {
    const { rows: theirs } = await owner.query<{ balance: string; flows: string }>(
      `select a.balance::text as balance,
              (select coalesce(sum(x.margin + x.fee - x.payout), 0) from perps.events x
               where x.account_id = a.id)::text as flows
       from ledger.accounts a where a.kind = 'person' and a.user_id = $1`,
      [userId],
    );
    const mine = theirs[0];
    if (!mine) throw new Error('No such person');
    expect(micros(mine.balance), 'a balance').toBe(micros(starting) - micros(mine.flows));
  }
  expect(await problems()).toEqual([]);
}

/** Switched off once a test is done, so the jobs in the other tests leave its perp alone. */
async function switchOff(perpId: string) {
  await setPerpMode(app, ADMIN, { id: perpId, mode: 'halted', reason: 'The test is done' });
}

/** The contract's own check of a call's answer. */
async function passes(
  schema: { '~standard': { validate: (value: unknown) => unknown } },
  value: unknown,
) {
  const result = (await schema['~standard'].validate(value)) as { issues?: unknown[] };
  expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
}

const outputOf = (procedure: { '~orpc': { outputSchema?: unknown } }) =>
  procedure['~orpc'].outputSchema as { '~standard': { validate: (value: unknown) => unknown } };

async function refusalOf(work: Promise<unknown>): Promise<PerpTradingError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(PerpTradingError);
  return error as PerpTradingError;
}

async function storedRequests(requestId: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    'select count(*)::int as n from perps.requests where id = $1',
    [requestId],
  );
  return rows[0]?.n ?? 0;
}

/** Waits until the walk's step `step` has started (and a little more). */
async function untilStep(walk: Walk, step: number) {
  await sleep(Math.max(stepStart(walk, step) - Date.now(), 0) + 150);
}

describe("the perp's steps", () => {
  it('opens, adds, closes part, flips and closes, the books exact after every step', async () => {
    const { id: perp } = await testPerp();
    const ann = await person('1000');
    const people = new Map([[ann, '1000']]);

    const opened = await trade(ann, perp, opening('long', '100', '5'));
    expect(opened).toMatchObject({ status: 'opened', margin: '100.000000', fee: '0.500000' });
    expect(opened.balance).toBe('899.500000');
    expect(opened.position?.direction).toBe('long');
    expect(Number(opened.position?.size)).toBeCloseTo(500, 6);
    // The next-price rule: the price it filled at was published after the order was placed.
    expect(Date.parse(opened.price_at)).toBeGreaterThan(Date.parse(opened.placed_at));
    await booksAddUp(perp, people);

    const added = await trade(ann, perp, opening('long', '50', '5'));
    expect(added.status).toBe('added');
    expect(Number(added.position?.size)).toBeCloseTo(750, 3);
    await booksAddUp(perp, people);

    // Closing part without the size it was sized on is refused, as a screen gone stale would be.
    const unsized = await trade(ann, perp, closing('0.5'));
    expect(unsized).toMatchObject({ status: 'refused', refusal: { code: 'bad_request' } });
    const moved = await trade(ann, perp, closing('0.5', '700'));
    expect(moved).toMatchObject({ status: 'refused', refusal: { code: 'position_changed' } });
    const half = await trade(ann, perp, closing('0.5', added.position?.size));
    expect(half.status).toBe('closed');
    expect(micros(half.payout) > 0n).toBe(true);
    expect(Number(half.position?.size)).toBeCloseTo(375, 3);
    await booksAddUp(perp, people);

    // Opening the other way closes the long first, at the same price, then opens the short.
    const flipped = await trade(ann, perp, opening('short', '40', '2'));
    expect(flipped.status).toBe('opened');
    expect(flipped.position?.direction).toBe('short');
    expect(micros(flipped.payout) > 0n).toBe(true);
    const { rows } = await owner.query<{ direction: string; close_reason: string | null }>(
      `select x.direction, x.close_reason from perps.positions x
       join ledger.accounts a on a.id = x.account_id
       where x.perp_id = $1 and a.user_id = $2 order by x.opened_at, x.id`,
      [perp, ann],
    );
    expect(rows).toEqual([
      { direction: 'long', close_reason: 'flipped' },
      { direction: 'short', close_reason: null },
    ]);
    await booksAddUp(perp, people);

    const closed = await trade(ann, perp, closing('1'));
    expect(closed.status).toBe('closed');
    expect(closed.position).toBeNull();
    await booksAddUp(perp, people);
    await switchOff(perp);
  });

  it('answers a retried request with its first answer and never trades twice, even at once', async () => {
    const { id: perp } = await testPerp();
    const raj = await person('1000');
    const people = new Map([[raj, '1000']]);

    const request = opening('short', '20', '3');
    const first = await trade(raj, perp, request);
    const again = await runStep(app, raj, perp, request, SOURCE);
    expect(again).toEqual({ kind: 'replay', result: first });
    // The same ID for a different request is refused.
    await expect(
      runStep(app, raj, perp, { ...request, params: { ...request.params, margin: '21' } }, SOURCE),
    ).rejects.toMatchObject({ code: '23505' });

    // Sent twice at once: one trades, the other waits for the perp's lock and gets that answer.
    const twice = opening('short', '10', '2');
    const answers = await Promise.all([
      runStep(app, raj, perp, twice, SOURCE),
      runStep(app, raj, perp, twice, SOURCE),
    ]);
    expect(answers.map((answer) => answer.kind).sort()).toEqual(['applied', 'replay']);
    const [one, other] = answers.map((answer) => ('result' in answer ? answer.result : null));
    expect(one).toEqual(other);
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from perps.events where request_id = $1',
      [twice.requestId],
    );
    expect(rows[0]?.n).toBe(1);
    expect(await storedRequests(twice.requestId)).toBe(1);
    await booksAddUp(perp, people);
    await trade(raj, perp, closing('1'));
    await booksAddUp(perp, people);
    await switchOff(perp);
  });

  it('refuses in the books what can’t trade, storing the refusal and moving nothing', async () => {
    const { id: perp } = await testPerp();
    const zoe = await person('1000');
    const people = new Map([[zoe, '1000']]);

    for (const [request, code] of [
      [opening('long', '100', '11'), 'leverage_too_high'],
      [opening('long', '999.5', '1'), 'insufficient_balance'],
      [closing('1'), 'no_position'],
    ] as const) {
      const answer = await trade(zoe, perp, request);
      expect(answer.status).toBe('refused');
      expect(answer.refusal?.code).toBe(code);
      expect(answer.balance).toBe('1000.000000');
      expect(await storedRequests(request.requestId)).toBe(1);
    }
    await booksAddUp(perp, people);

    // Closing only: a new position is refused, closing one still works.
    await trade(zoe, perp, opening('long', '30', '2'));
    await setPerpMode(app, ADMIN, { id: perp, mode: 'reduce-only', reason: 'Winding down' });
    const more = await trade(zoe, perp, opening('long', '10', '2'));
    expect(more).toMatchObject({ status: 'refused', refusal: { code: 'trading_off' } });
    // Switched off: nothing trades at all, and the books take no new price.
    await setPerpMode(app, ADMIN, { id: perp, mode: 'halted', reason: 'Stopped' });
    const { rows: before } = await owner.query<{ steps: string }>(
      'select steps::text from perps.perps where id = $1',
      [perp],
    );
    const stopped = await trade(zoe, perp, closing('1'));
    expect(stopped).toMatchObject({ status: 'refused', refusal: { code: 'trading_off' } });
    expect(await runStep(app, null, perp, { action: 'tick' }, SOURCE)).toEqual({ kind: 'nothing' });
    const { rows: prices } = await owner.query<{ n: number }>(
      'select count(*)::int as n from perps.prices where perp_id = $1 and step > $2',
      [perp, before[0]?.steps],
    );
    expect(prices[0]?.n).toBe(0);
    await setPerpMode(app, ADMIN, { id: perp, mode: 'reduce-only', reason: 'Closing only again' });
    const closed = await trade(zoe, perp, closing('1'));
    expect(closed.status).toBe('closed');
    await booksAddUp(perp, people);
    await switchOff(perp);
  });

  it('prices each 5-second step once, however many ticks run at once', async () => {
    const { id: perp, walk } = await testPerp();
    const kai = await person('1000');
    const people = new Map([[kai, '1000']]);
    const opened = await trade(kai, perp, opening('long', '10', '2'));
    const filledStep = stepOf(walk, Date.parse(opened.price_at));
    // Within the step the open priced, a tick has nothing to do.
    if (stepOf(walk, Date.now() + 200) === filledStep) {
      expect(await runStep(app, null, perp, { action: 'tick' }, SOURCE)).toEqual({
        kind: 'nothing',
      });
    }
    await untilStep(walk, filledStep + 1);
    const ticks = await Promise.all(
      Array.from({ length: 4 }, () => runStep(app, null, perp, { action: 'tick' }, SOURCE)),
    );
    const kinds = ticks.map((tick) => tick.kind);
    expect(kinds.filter((kind) => kind === 'applied')).toHaveLength(1);
    expect(kinds.every((kind) => ['applied', 'busy', 'nothing'].includes(kind))).toBe(true);
    const { rows } = await owner.query<{ at: string; price: string }>(
      `select markets.utc(at) as at, price::text from perps.prices
       where perp_id = $1 order by at`,
      [perp],
    );
    // One row a step, each the walk's own price for that step.
    expect(new Set(rows.map((row) => row.at)).size).toBe(rows.length);
    for (const row of rows) {
      expect(Number(row.price)).toBe(priceOf(walk, Date.parse(row.at)).price);
    }
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await booksAddUp(perp, people);
    await trade(kai, perp, closing('1'));
    await booksAddUp(perp, people);
    await switchOff(perp);
  });

  it('liquidates a 10-times long when its seeded price falls past it, and pays a short its profit', async () => {
    // A test perp that moves fast (10,000% a year: about 4% a step), with a seed found so that,
    // a few steps after the long opens, the price is well below where 10 times is liquidated.
    const origin = Date.now() - 60_000;
    const base = { origin, startPrice: 100, annualVolatility: 100 };
    const fill = stepOf({ seed: '', ...base }, Date.now() + 500);
    let walk: Walk | undefined;
    for (let tries = 0; tries < 50_000 && !walk; tries++) {
      const candidate = { seed: randomSeed(), ...base };
      const at = (step: number) => priceOf(candidate, stepStart(candidate, step)).price;
      const high = Math.max(at(fill), at(fill + 1));
      // The two steps the opens may fill at are close, so the long isn't liquidated as it opens.
      if (Math.abs(at(fill + 1) / at(fill) - 1) > 0.03) continue;
      for (let j = fill + 2; j <= fill + 5; j++) {
        if ([j, j + 1, j + 2].every((k) => at(k) <= high * 0.86)) {
          walk = candidate;
          break;
        }
      }
    }
    if (!walk) throw new Error('No seed found');
    const { id: perp } = await testPerp({ seed: walk.seed, origin, volatility: 100 });
    const lee = await person('1000');
    const mia = await person('1000');
    const people = new Map([
      [lee, '1000'],
      [mia, '1000'],
    ]);

    const short = await trade(mia, perp, opening('short', '20', '2'));
    const long = await trade(lee, perp, opening('long', '50', '10'));
    expect(short.status).toBe('opened');
    expect(long.status).toBe('opened');
    const liquidation = Number(long.position?.liquidationPrice);
    expect(liquidation).toBeLessThan(Number(long.price));
    await booksAddUp(perp, people);

    const opened = stepOf(walk, Date.parse(long.price_at));
    let past = opened + 1;
    while (priceOf(walk, stepStart(walk, past)).price > liquidation) past += 1;
    expect(past - opened).toBeLessThan(10);
    await untilStep(walk, past);
    const run = await runJob(app, 'tick', SOURCE);
    expect(run.failed).toEqual([]);
    expect(run.liquidations).toBeGreaterThanOrEqual(1);

    const { rows } = await owner.query<{ close_reason: string | null; kinds: string[] }>(
      `select x.close_reason,
              array(select e.kind from perps.events e where e.position_id = x.id order by e.id) as kinds
       from perps.positions x join ledger.accounts a on a.id = x.account_id
       where x.perp_id = $1 and a.user_id = $2`,
      [perp, lee],
    );
    expect(rows).toEqual([{ close_reason: 'liquidated', kinds: ['open', 'liquidation'] }]);
    // Liquidated, Lee's margin and fee are gone and nothing comes back.
    const { rows: hers } = await owner.query<{ balance: string }>(
      `select a.balance::text from ledger.accounts a where a.kind = 'person' and a.user_id = $1`,
      [lee],
    );
    expect(hers[0]?.balance).toBe('949.500000');
    await booksAddUp(perp, people);

    // The short, on the other side of the fall, closes at a profit.
    const closed = await trade(mia, perp, closing('1'));
    expect(closed.status).toBe('closed');
    expect(micros(closed.balance) > micros('1000')).toBe(true);
    await booksAddUp(perp, people);
    await switchOff(perp);
  }, 120_000);

  it('pays funding once a period, from the crowded side to the other', async () => {
    // The first funding period started two hours ago, so funding is due now.
    const { id: perp } = await testPerp({
      fundingFrom: new Date(Date.now() - 7_200_000).toISOString(),
    });
    const ivy = await person('1000');
    const max = await person('1000');
    const people = new Map([
      [ivy, '1000'],
      [max, '1000'],
    ]);
    await trade(ivy, perp, opening('long', '100', '5'));
    await trade(max, perp, opening('short', '20', '5'));
    const due = await owner.query<{ ids: string[] }>("select perps.due('funding') as ids");
    expect(due.rows[0]?.ids).toContain(perp);

    const funded = await runStep(app, null, perp, { action: 'funding' }, SOURCE);
    expect(funded.kind).toBe('applied');
    if (funded.kind !== 'applied') return;
    expect(funded.result).toMatchObject({ funded: true });
    expect(Number(funded.result.rate)).toBeGreaterThan(0);
    const { rows } = await owner.query<{
      rate: string;
      long_change: string;
      short_change: string;
    }>(
      `select rate::text, (pool_long_after - pool_long_before)::text as long_change,
              (pool_short_after - pool_short_before)::text as short_change
       from perps.fundings where perp_id = $1`,
      [perp],
    );
    expect(rows).toHaveLength(1);
    const paid = rows[0];
    if (!paid) throw new Error('No funding');
    // The longs, crowded, paid the shorts: out of one pool, into the other, to the millionth.
    expect(micros(paid.long_change) < 0n).toBe(true);
    expect(micros(paid.long_change) + micros(paid.short_change)).toBe(0n);
    const { rows: events } = await owner.query<{ n: number }>(
      `select count(*)::int as n from perps.events where perp_id = $1 and phase = 'funding'`,
      [perp],
    );
    expect(events[0]?.n).toBe(2);

    // Once a period: straight after, funding isn't due.
    expect(await runStep(app, null, perp, { action: 'funding' }, SOURCE)).toEqual({
      kind: 'nothing',
    });
    const after = await owner.query<{ ids: string[] }>("select perps.due('funding') as ids");
    expect(after.rows[0]?.ids).not.toContain(perp);
    await booksAddUp(perp, people);
    await trade(ivy, perp, closing('1'));
    await trade(max, perp, closing('1'));
    await booksAddUp(perp, people);
    await switchOff(perp);
  });

  it('runs the jobs only on perps that are switched on and hold a position', async () => {
    const { id: empty } = await testPerp();
    const { id: held } = await testPerp();
    const ned = await person('1000');
    await trade(ned, held, opening('long', '10', '2'));
    const { rows } = await owner.query<{ ids: string[] }>("select perps.due('tick') as ids");
    const due = rows[0]?.ids ?? [];
    expect(due).toContain(held);
    expect(due).not.toContain(empty);
    // The Bitcoin perp starts switched off, so no job touches it.
    expect(due).not.toContain(BITCOIN);
    await switchOff(held);
    const { rows: off } = await owner.query<{ ids: string[] }>("select perps.due('tick') as ids");
    expect(off[0]?.ids).not.toContain(held);
    const run = await runJob(app, 'tick', SOURCE);
    expect(run.failed).toEqual([]);
    expect(run.notSetUp).toBe(0);
    await switchOff(empty);
    await booksAddUp(held, new Map([[ned, '1000']]));
  });
});

describe('the calls for everyone', () => {
  it('opens and closes at the next new price, each answer the contract’s, a retry its first', async () => {
    const { id: perp } = await testPerp();
    const ola = await person('1000');
    const people = new Map([[ola, '1000']]);
    const opened = await openPerp(
      app,
      ola,
      { perpId: perp, requestId: randomUUID(), direction: 'long', margin: '10', leverage: '2' },
      SOURCE,
    );
    await passes(outputOf(contract.perps.open), opened);
    expect(opened).toMatchObject({ status: 'opened', margin: '10.000000', fee: '0.020000' });
    expect(Date.parse(opened.priceAt)).toBeGreaterThan(Date.parse(opened.placedAt));

    const page = await perpPositions(app, ola, {}, SOURCE);
    await passes(outputOf(contract.portfolio.perps), page);
    expect(page.positions.map((held) => held.perpId)).toEqual([perp]);
    expect(page.balance).toBe('989.980000');

    const request = { perpId: perp, requestId: randomUUID(), fraction: '1' };
    const closed = await closePerp(app, ola, request, SOURCE);
    await passes(outputOf(contract.perps.close), closed);
    expect(closed.status).toBe('closed');
    expect(closed.position).toBeNull();
    expect(micros(closed.balance)).toBe(micros('989.980000') + micros(closed.payout));
    // A retry: the first answer, at once, with no second trade.
    const started = Date.now();
    expect(await closePerp(app, ola, request, SOURCE)).toEqual(closed);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((await perpPositions(app, ola, {}, SOURCE)).positions).toEqual([]);
    await booksAddUp(perp, people);
    await switchOff(perp);
  }, 60_000);

  it('refuses before the books what plainly can’t trade, writing nothing', async () => {
    const { id: perp } = await testPerp();
    const pia = await person('1000');
    const asks = [
      [{ leverage: '11', margin: '10' }, 'leverage_too_high'],
      [{ leverage: '10', margin: '995' }, 'insufficient_balance'],
    ] as const;
    for (const [ask, reason] of asks) {
      const requestId = randomUUID();
      const error = await refusalOf(
        openPerp(app, pia, { perpId: perp, requestId, direction: 'long', ...ask }, SOURCE),
      );
      expect(error).toMatchObject({ kind: 'refused', reason });
      expect(await storedRequests(requestId)).toBe(0);
    }
    const nothing = randomUUID();
    expect(
      await refusalOf(
        closePerp(app, pia, { perpId: perp, requestId: nothing, fraction: '1' }, SOURCE),
      ),
    ).toMatchObject({ kind: 'refused', reason: 'no_position' });
    expect(await storedRequests(nothing)).toBe(0);
    await setPerpMode(app, ADMIN, { id: perp, mode: 'reduce-only', reason: 'Closing only' });
    expect(
      await refusalOf(
        openPerp(
          app,
          pia,
          { perpId: perp, requestId: randomUUID(), direction: 'short', margin: '5', leverage: '1' },
          SOURCE,
        ),
      ),
    ).toMatchObject({ kind: 'refused', reason: 'trading_off' });
    await switchOff(perp);
    expect(
      await refusalOf(
        openPerp(
          app,
          pia,
          { perpId: perp, requestId: randomUUID(), direction: 'short', margin: '5', leverage: '1' },
          SOURCE,
        ),
      ),
    ).toMatchObject({ kind: 'refused', reason: 'trading_off' });
    expect(
      await refusalOf(
        openPerp(
          app,
          pia,
          {
            perpId: newId(),
            requestId: randomUUID(),
            direction: 'long',
            margin: '5',
            leverage: '1',
          },
          SOURCE,
        ),
      ),
    ).toMatchObject({ kind: 'not_found' });
    await booksAddUp(perp, new Map([[pia, '1000']]));
  });

  it('shows anyone a perp’s price now, on the database’s clock', async () => {
    const { id: perp, walk } = await testPerp();
    const shown = await perpDetails(app, perp, SOURCE);
    await passes(outputOf(contract.perps.get), shown);
    expect(shown).toMatchObject({ id: perp, listed: false, tradingMode: 'enabled' });
    const at = Date.parse(shown.priceAt);
    expect(at).toBe(stepStart(walk, stepOf(walk, at)));
    expect(at).toBeLessThanOrEqual(Date.now() + 50);
    expect(Date.parse(shown.nextPriceAt)).toBe(at + STEP);
    expect(shown.price).toBe(String(priceOf(walk, at).price));

    // The listed perp is on our own price: before the first is stored, its price isn't set up
    // here, whatever the environment's seed.
    await expect(listedPerps(app, SOURCE)).rejects.toBeInstanceOf(PerpNotSetUpError);
    await expect(listedPerps(app, { seed: undefined })).rejects.toBeInstanceOf(PerpNotSetUpError);
    expect(await refusalOf(perpDetails(app, newId(), SOURCE))).toMatchObject({ kind: 'not_found' });
    await switchOff(perp);
  });
});

describe('the Bitcoin perp on our own price (3.4b)', () => {
  /**
   * A price of ours stored now, as the schedule stores one, asked for at the database's own time.
   * Written by the test itself: no check ever asks an exchange.
   */
  async function store(price: string): Promise<string> {
    const { rows } = await owner.query<{ at: string }>(
      `insert into prices.points (feed, at, price, sources, published_at)
       values ('btc-usd', date_trunc('milliseconds', clock_timestamp()), $1, 3, clock_timestamp())
       returning markets.utc(at) as at`,
      [price],
    );
    const at = rows[0]?.at;
    if (!at) throw new Error('No price stored');
    return at;
  }

  /** Switched on and off by the database's owner: no jobs are set up here, so nothing is asked. */
  async function bitcoinMode(mode: 'enabled' | 'halted') {
    await owner.query('update perps.perps set trading_mode = $2 where id = $1', [BITCOIN, mode]);
  }

  it('shows our newest stored price, fills each order at the next one stored after it, and ticks on each new one', async () => {
    const ola = await person('1000');
    const people = new Map([[ola, '1000']]);
    await bitcoinMode('enabled');
    try {
      const { rows } = await owner.query<{ wanted: boolean }>(
        "select prices.wanted('btc-usd') as wanted",
      );
      expect(rows[0]?.wanted, 'with no jobs set up, the price is never asked for here').toBe(false);

      const first = await store('73342.17');
      const shown = await perpDetails(app, BITCOIN, SOURCE);
      await passes(outputOf(contract.perps.get), shown);
      expect(shown).toMatchObject({ feed: 'btc-usd', price: '73342.17' });
      expect(Date.parse(shown.priceAt)).toBe(Date.parse(first));
      expect(Date.parse(shown.nextPriceAt) - Date.parse(shown.priceAt)).toBe(5_000);
      const list = await listedPerps(app, { seed: undefined });
      await passes(outputOf(contract.perps.list), list);
      expect(list.perps.map((listed) => [listed.id, listed.price])).toEqual([
        [BITCOIN, '73342.17'],
      ]);

      // An order waits for the next price stored after it, and fills at exactly that one.
      const opening = openPerp(
        app,
        ola,
        {
          perpId: BITCOIN,
          requestId: randomUUID(),
          direction: 'long',
          margin: '10',
          leverage: '2',
        },
        SOURCE,
      );
      await sleep(1_500);
      const next = await store('73350.25');
      const opened = await opening;
      await passes(outputOf(contract.perps.open), opened);
      expect(opened).toMatchObject({ status: 'opened', price: '73350.25', priceAt: next });
      expect(Date.parse(opened.priceAt)).toBeGreaterThan(Date.parse(opened.placedAt));
      expect(opened.position?.entryPrice).toBe('73350.25');

      // The tick applies a newer price, once.
      const later = await store('73360.5');
      const { rows: due } = await owner.query<{ ids: string[] }>("select perps.due('tick') as ids");
      expect(due[0]?.ids).toContain(BITCOIN);
      const run = await runJob(app, 'tick', SOURCE);
      expect(run.failed).toEqual([]);
      const { rows: book } = await owner.query<{ price: string; at: string }>(
        'select price::text as price, markets.utc(price_at) as at from perps.perps where id = $1',
        [BITCOIN],
      );
      expect(book[0]).toEqual({ price: '73360.5', at: later });
      const { rows: after } = await owner.query<{ ids: string[] }>(
        "select perps.due('tick') as ids",
      );
      expect(after[0]?.ids, 'nothing newer: no tick').not.toContain(BITCOIN);

      // Its positions are worth what they are at our newest price.
      const page = await perpPositions(app, ola, {}, SOURCE);
      expect(page.positions.map((held) => [held.perpId, held.price])).toEqual([
        [BITCOIN, '73360.5'],
      ]);

      const closing = closePerp(
        app,
        ola,
        { perpId: BITCOIN, requestId: randomUUID(), fraction: '1' },
        SOURCE,
      );
      await sleep(1_500);
      const last = await store('73340.75');
      const closed = await closing;
      expect(closed).toMatchObject({ status: 'closed', price: '73340.75', priceAt: last });
      await booksAddUp(BITCOIN, people);
    } finally {
      await bitcoinMode('halted');
    }
  }, 60_000);

  it('refuses an order when no price is stored after it, unfilled and unrecorded', async () => {
    const pia = await person('1000');
    await bitcoinMode('enabled');
    try {
      const requestId = randomUUID();
      const started = Date.now();
      const error = await refusalOf(
        openPerp(
          app,
          pia,
          { perpId: BITCOIN, requestId, direction: 'short', margin: '5', leverage: '1' },
          SOURCE,
        ),
      );
      expect(error).toMatchObject({ kind: 'refused', reason: 'stale_price' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(OWN_PRICE_WAIT_MS - 1_000);
      expect(await storedRequests(requestId)).toBe(0);
      await booksAddUp(BITCOIN, new Map([[pia, '1000']]));
    } finally {
      await bitcoinMode('halted');
    }
  }, 60_000);
});
