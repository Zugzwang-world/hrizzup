import { randomUUID } from 'node:crypto';
import { priceFor } from '@hrizzup/perps';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, decimal, micros } from '../support/books.ts';
import { newRunTrader, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the perp with no one touching it (PLAN.md step 3.4a's done-test: "liquidations and
 * funding run with no one touching them"), on the pull request's preview, whose database is
 * staging's: staging's own schedule (Supabase Cron, every 5 seconds and every minute) runs the
 * prices, liquidations and funding of every perp that's switched on with a position, the run's test
 * perps included, through staging's jobs address. Each check run on its own: its own test perps
 * (unlisted, each with its own seed), its own fresh accounts, and the books adding up to the
 * millionth at the end of each journey; each perp is retired, its pools back to the house.
 * - A 10-times long is liquidated when the seeded price falls past it: the run picks a seed whose
 *   price, a few steps after the long opens, is well below its liquidation price and stays there.
 * - Funding: a long crowds the perp, its first funding period two hours past, so within a minute
 *   the schedule moves funding from the long's pool to the short's, once.
 * - A long and a short close as the seeded price rises: the long at a profit, the short at a loss.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

const STARTING = micros('1000');
const SUBSIDY = micros('1000');
/** The stand-in's 5-second steps. */
const STEP = 5_000;

type Walk = { seed: string; origin: number; volatility: string };

const iso = (ms: number) => new Date(ms).toISOString();

/** The walk's price at its step `k`: the server's own function (`@hrizzup/perps`). */
function stepPrice(walk: Walk, k: number): number {
  const price = priceFor(
    {
      seed: walk.seed,
      standIn: { origin: iso(walk.origin), startPrice: '100', volatility: walk.volatility },
    },
    { seed: undefined },
  );
  return price(walk.origin + k * STEP).price;
}

const stepOf = (walk: Pick<Walk, 'origin'>, moment: number) =>
  Math.floor((moment - walk.origin) / STEP);

const randomSeed = () =>
  [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * A walk starting a minute ago whose next steps do what `wanted` asks, given its price at a step and
 * the first step an order placed now could fill at (an order fills at the first price published after
 * it is placed, so a few steps on).
 */
function walkWhere(
  volatility: string,
  wanted: (at: (k: number) => number, first: number) => boolean,
): Walk {
  const origin = Date.now() - 60_000;
  const first = stepOf({ origin }, Date.now() + 3_000);
  for (let tries = 0; tries < 200_000; tries++) {
    const walk = { seed: randomSeed(), origin, volatility };
    if (wanted((k) => stepPrice(walk, k), first)) {
      firsts.set(walk, first);
      return walk;
    }
  }
  throw new Error('No seed gives that walk');
}

/** The first step an order could fill at, for each walk `walkWhere` found. */
const firsts = new WeakMap<Walk, number>();
const firstFill = (walk: Walk) => {
  const first = firsts.get(walk);
  if (first === undefined) throw new Error('A walk walkWhere did not find');
  return first;
};

/** Every perp this process's journeys made, so each test's cleanup can switch its own off. */
const perpsMade: string[] = [];

/** The run's own test perp, on `walk`, made and switched on by the console's admin test account. */
async function runPerp(
  admin: APIRequestContext,
  label: string,
  walk: Walk,
  fundingFrom?: string,
): Promise<string> {
  const id = newRecordId();
  const made = await call(admin, 'POST', '/api/v1/admin/perps', {
    id,
    name: `Perp jobs journey: ${label} (run ${runKey()})`.slice(0, 120),
    seed: walk.seed,
    standIn: { origin: iso(walk.origin), startPrice: '100', volatility: walk.volatility },
    settings: {
      maxLeverage: '10',
      takerFeeBps: '10',
      takerFeeImpact: '0',
      fundingPeriodMs: '3600000',
      fundingSensitivity: '1',
      maxFundingRate: '0.0001',
      maxPriceAgeMs: '120000',
      subsidyLong: decimal(SUBSIDY),
      subsidyShort: decimal(SUBSIDY),
    },
    ...(fundingFrom ? { fundingFrom } : {}),
    reason: `The perp jobs journey's own test perp (run ${runKey()})`,
  });
  expect(made.status, 'the console makes the test perp').toBe(201);
  perpsMade.push(id);
  const on = await call(admin, 'POST', `/api/v1/admin/perps/${id}/mode`, {
    mode: 'enabled',
    reason: `The perp jobs journey trades it (run ${runKey()})`,
  });
  expect(on.body).toMatchObject({ tradingMode: 'enabled' });
  return id;
}

type Trade = { margin: string; fee: string; payout: string; balance: string; priceAt: string };

/** A trade that must go through, with a request ID of its own. */
async function trade(
  trader: APIRequestContext,
  perpId: string,
  path: 'open' | 'close',
  order: Record<string, unknown>,
): Promise<Trade & Record<string, unknown>> {
  const answer = await call(trader, 'POST', `/api/v1/perps/${path}`, {
    perpId,
    requestId: randomUUID(),
    ...order,
  });
  expect(answer.status, `${path}: ${JSON.stringify(answer.body)}`).toBe(200);
  return answer.body as Trade & Record<string, unknown>;
}

/** Asks again every 2 seconds until `found` gives something, or `seconds` pass. */
async function eventually<T>(seconds: number, found: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const value = await found();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`Nothing after ${seconds} seconds`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/** The perp as the console sees it (never kept anywhere, so always the database's latest). */
async function books(admin: APIRequestContext, perpId: string) {
  const answer = await call(admin, 'GET', `/api/v1/admin/perps/${perpId}`);
  expect(answer.status).toBe(200);
  return answer.body as {
    pools: { long: string; short: string };
    lastFundingAt: string | null;
    price: string | null;
  };
}

/**
 * The books to the millionth: each trader's balance is the starting balance less what they put in
 * plus what they were paid (their answers say), and the pools hold the house's subsidy plus everything
 * put in less everything paid out (funding and liquidations move money only between the pools).
 */
async function booksAddUp(
  admin: APIRequestContext,
  perpId: string,
  traders: { as: APIRequestContext; trades: Trade[] }[],
) {
  let putIn = 0n;
  let paidOut = 0n;
  for (const { as, trades } of traders) {
    const mine = trades.reduce((sum, t) => sum + micros(t.margin) + micros(t.fee), 0n);
    const paid = trades.reduce((sum, t) => sum + micros(t.payout), 0n);
    putIn += mine;
    paidOut += paid;
    const held = await call(as, 'GET', '/api/v1/me/perps');
    expect(held.body.balance, "a trader's balance").toBe(decimal(STARTING - mine + paid));
  }
  const { pools } = await books(admin, perpId);
  expect(decimal(micros(pools.long) + micros(pools.short)), "the perp's pools").toBe(
    decimal(SUBSIDY * 2n + putIn - paidOut),
  );
}

async function retire(admin: APIRequestContext, perpId: string) {
  const retired = await call(admin, 'POST', `/api/v1/admin/perps/${perpId}/retire`, {
    reason: `The perp jobs journey is done (run ${runKey()})`,
  });
  expect(retired.body).toMatchObject({
    state: 'retired',
    pools: { long: '0.000000', short: '0.000000' },
  });
}

test.describe('the perp with no one touching it', () => {
  test.skip(() => environment() === 'production', 'No test accounts on production until launch');
  test.skip(
    () => environment() === 'staging',
    "Staging's firewall lets only browsers write to the typed API",
  );
  test.setTimeout(300_000);

  let admin: APIRequestContext;
  test.beforeEach(async ({ playwright, baseURL, browserName }) => {
    admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
  });
  test.afterEach(async () => {
    // Pass or fail, the test's perps end switched off, so staging's schedule leaves them alone, and
    // retired where nothing is left open on them (a retire asked again answers with the retired one).
    for (const id of perpsMade.splice(0)) {
      await call(admin, 'POST', `/api/v1/admin/perps/${id}/mode`, {
        mode: 'halted',
        reason: `The perp jobs journey cleans up (run ${runKey()})`,
      }).catch(() => undefined);
      await call(admin, 'POST', `/api/v1/admin/perps/${id}/retire`, {
        reason: `The perp jobs journey cleans up (run ${runKey()})`,
      }).catch(() => undefined);
    }
    await admin.dispose();
  });

  test('a 10-times long is liquidated by the schedule when the seeded price falls past it', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const { as: trader } = await newRunTrader(
      keys,
      playwright,
      baseURL,
      browserName as Engine,
      'perp-liq',
    );
    // About 4% a step: a few steps after the long fills, the price is 15% below it, and stays there
    // for half a minute, so one of the schedule's 5-second runs is sure to see it.
    const walk = walkWhere('100', (at, first) => {
      const fills = [first, first + 1, first + 2, first + 3].map(at);
      const high = Math.max(...fills);
      if (high / Math.min(...fills) > 1.04) return false;
      for (let j = first + 5; j <= first + 9; j++) {
        if ([0, 1, 2, 3, 4, 5].every((d) => at(j + d) <= high * 0.85)) return true;
      }
      return false;
    });
    const perp = await runPerp(admin, `liquidation (${browserName})`, walk);
    const long = await trade(trader, perp, 'open', {
      direction: 'long',
      margin: '10',
      leverage: '10',
    });
    const liquidation = Number((long.position as { liquidationPrice: string }).liquidationPrice);
    expect(liquidation).toBeLessThan(Number(long.price));

    // Nobody closes it: the schedule's tick applies the price that crosses it, and it's gone.
    await eventually(120, async () => {
      const held = await call(trader, 'GET', '/api/v1/me/perps');
      return (held.body.positions as unknown[]).length === 0 ? held : undefined;
    });
    const after = await books(admin, perp);
    expect(Number(after.price), 'the price the schedule applied crossed it').toBeLessThanOrEqual(
      liquidation,
    );
    // Liquidated: the margin and the fee stay in the pools, nothing comes back.
    await booksAddUp(admin, perp, [{ as: trader, trades: [long] }]);
    // Ṁ10 of margin and a fee of 10 basis points of its Ṁ100: Ṁ10.10 gone.
    expect((await call(trader, 'GET', '/api/v1/me/perps')).body.balance).toBe('989.900000');
    await retire(admin, perp);
    await trader.dispose();
  });

  test('funding moves from the crowded long to the short within a minute of falling due, once', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const { as: longer } = await newRunTrader(keys, playwright, baseURL, engine, 'perp-fund-l');
    const { as: shorter } = await newRunTrader(keys, playwright, baseURL, engine, 'perp-fund-s');
    // Bitcoin's own volatility: calm, so nothing is liquidated. Its first period started just under
    // an hour ago, so its first funding falls due a minute from now: after both positions are open
    // and the pools are read below. (Due already, the schedule's run every minute could fund it
    // between the two trades, and nothing would be left to see.)
    const walk = walkWhere('0.55', () => true);
    const perp = await runPerp(
      admin,
      `funding (${browserName})`,
      walk,
      iso(Date.now() - 3_600_000 + 60_000),
    );
    const long = await trade(longer, perp, 'open', {
      direction: 'long',
      margin: '100',
      leverage: '5',
    });
    const short = await trade(shorter, perp, 'open', {
      direction: 'short',
      margin: '20',
      leverage: '5',
    });
    const before = await books(admin, perp);
    expect(before.lastFundingAt, 'not funded by the trades themselves').toBeNull();

    // Nobody asks: the schedule's funding run, every minute, finds it due (within a minute of it
    // falling due, a minute from the start).
    const funded = await eventually(180, async () => {
      const now = await books(admin, perp);
      return now.lastFundingAt ? now : undefined;
    });
    const longChange = micros(funded.pools.long) - micros(before.pools.long);
    const shortChange = micros(funded.pools.short) - micros(before.pools.short);
    expect(longChange, "the crowded long's pool paid").toBeLessThan(0n);
    expect(shortChange, 'the same into the short pool').toBe(-longChange);
    const longHeld = (await call(longer, 'GET', '/api/v1/me/perps')).body.positions as {
      margin: string;
    }[];
    const shortHeld = (await call(shorter, 'GET', '/api/v1/me/perps')).body.positions as {
      margin: string;
    }[];
    expect(Number(longHeld[0]?.margin), "the long's margin paid it").toBeLessThan(100);
    expect(Number(shortHeld[0]?.margin), "the short's margin received it").toBeGreaterThan(20);

    const longClosed = await trade(longer, perp, 'close', { fraction: '1' });
    const shortClosed = await trade(shorter, perp, 'close', { fraction: '1' });
    // Once a period: it hasn't run again.
    expect((await books(admin, perp)).lastFundingAt).toBe(funded.lastFundingAt);
    await booksAddUp(admin, perp, [
      { as: longer, trades: [long, longClosed] },
      { as: shorter, trades: [short, shortClosed] },
    ]);
    await retire(admin, perp);
    await Promise.all([longer.dispose(), shorter.dispose()]);
  });

  test('as the seeded price rises, a long closes at a profit and a short at a loss', async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    const keys = stagingKeys();
    if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
    const engine = browserName as Engine;
    const { as: longer } = await newRunTrader(keys, playwright, baseURL, engine, 'perp-pnl-l');
    const { as: shorter } = await newRunTrader(keys, playwright, baseURL, engine, 'perp-pnl-s');
    // About 0.8% a step: from where the opens fill, the price is at least 3% higher five steps on,
    // and stays there while both close.
    const walk = walkWhere('20', (at, first) => {
      const fills = [first, first + 1, first + 2, first + 3].map(at);
      const high = Math.max(...fills);
      if (high / Math.min(...fills) > 1.02) return false;
      return [6, 7, 8, 9, 10, 11, 12].every((d) => at(first + d) >= high * 1.03);
    });
    const perp = await runPerp(admin, `profit and loss (${browserName})`, walk);
    const long = await trade(longer, perp, 'open', {
      direction: 'long',
      margin: '20',
      leverage: '5',
    });
    const short = await trade(shorter, perp, 'open', {
      direction: 'short',
      margin: '20',
      leverage: '2',
    });
    // Close once the rise has come: from the sixth step after the first an order could fill at.
    const rise = walk.origin + (firstFill(walk) + 6) * STEP;
    await new Promise((resolve) => setTimeout(resolve, Math.max(rise - Date.now(), 0) + 200));
    const longClosed = await trade(longer, perp, 'close', { fraction: '1' });
    const shortClosed = await trade(shorter, perp, 'close', { fraction: '1' });
    expect(micros(longClosed.payout), 'the long is paid more than its margin').toBeGreaterThan(
      micros(long.margin) + micros(long.fee),
    );
    expect(micros(shortClosed.payout), 'the short gets back less than its margin').toBeLessThan(
      micros(short.margin),
    );
    expect(micros(longClosed.balance)).toBeGreaterThan(STARTING);
    expect(micros(shortClosed.balance)).toBeLessThan(STARTING);
    await booksAddUp(admin, perp, [
      { as: longer, trades: [long, longClosed] },
      { as: shorter, trades: [short, shortClosed] },
    ]);
    await retire(admin, perp);
    await Promise.all([longer.dispose(), shorter.dispose()]);
  });
});
