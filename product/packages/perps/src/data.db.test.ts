import { randomUUID } from 'node:crypto';
import { contract } from '@hrizzup/api';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPerp, setPerpMode } from './console.ts';
import { latestPrice, NoPriceYetError, perpQuote, priceHistory } from './data.ts';
import { PerpNotSetUpError, type PriceSource } from './step.ts';
import { openPerp } from './trading.ts';

/**
 * The perp's quote and our own price's reads against a real database (PLAN.md steps 3.5c and 3.4b;
 * the Database check): a quote for an open matches the open that follows it, but for the price, which
 * moves to the next; refusals as the open's; and the price reads before and after a price is stored.
 */

const url = process.env.PERPS_DATABASE_URL;
if (!url) throw new Error('PERPS_DATABASE_URL is not set: run `pnpm test:db`');

const BITCOIN = '01a1c501-ec40-78f6-87b6-3fb041143421';
/** The environment's seed for the listed perp, in these tests only (staging's lives in Doppler). */
const SOURCE: PriceSource = { seed: 'a1b2c3d4e5f60718' };

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
    `${ADMIN}@perps-data.test`,
  ]);
  await owner.query(`insert into private.admins (user_id, note) values ($1, 'A test admin')`, [
    ADMIN,
  ]);
});

afterAll(async () => {
  await Promise.all([owner?.end(), app?.end()]);
});

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

async function passes(
  schema: { '~standard': { validate: (value: unknown) => unknown } },
  value: unknown,
) {
  const result = (await schema['~standard'].validate(value)) as { issues?: unknown[] };
  expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
}

const outputOf = (procedure: { '~orpc': { outputSchema?: unknown } }) =>
  procedure['~orpc'].outputSchema as { '~standard': { validate: (value: unknown) => unknown } };

/** Someone signed in with this much play money. */
async function person(starting = '1000'): Promise<string> {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@perps-data.test`,
  ]);
  await owner.query('select ledger.open_account($1, $2)', [userId, starting]);
  return userId;
}

describe("the perp's quote", () => {
  it('gives the open that follows it: its size, its fee, its liquidation price at its price', async () => {
    const { id: perp } = await testPerp();
    const ask = { direction: 'long' as const, margin: '10', leverage: '5' };
    const quoted = await perpQuote(app, { id: perp, ...ask }, SOURCE);
    await passes(outputOf(contract.perps.quote), quoted);
    expect(quoted).toMatchObject({
      perpId: perp,
      direction: 'long',
      margin: '10.000000',
      leverage: '5',
      size: '50',
      fee: '0.050000',
      cost: '10.050000',
    });
    const ola = await person('1000');
    const opened = await openPerp(
      app,
      ola,
      { perpId: perp, requestId: randomUUID(), ...ask },
      SOURCE,
    );
    expect(opened.position?.size).toBe(quoted.size);
    expect(opened.fee).toBe(quoted.fee);
    expect(opened.margin).toBe(quoted.margin);
    // The open filled at the next price: its liquidation price sits as far below it as the quote's.
    const ratio = (liquidation: string, price: string) => Number(liquidation) / Number(price);
    expect(ratio(String(opened.position?.liquidationPrice), opened.price)).toBeCloseTo(
      ratio(quoted.liquidationPrice, quoted.price),
      12,
    );
    // The asker the quote imagines holds nothing: the person's own position changes nothing in it.
    const again = await perpQuote(app, { id: perp, ...ask }, SOURCE);
    expect({ size: again.size, fee: again.fee }).toEqual({ size: quoted.size, fee: quoted.fee });
  }, 60_000);

  it('is refused as the open would be, and answers "no such perp" for none', async () => {
    const { id: perp } = await testPerp();
    await expect(
      perpQuote(app, { id: perp, direction: 'short', margin: '10', leverage: '11' }, SOURCE),
    ).rejects.toMatchObject({ kind: 'refused', reason: 'leverage_too_high' });
    await setPerpMode(app, ADMIN, { id: perp, mode: 'halted', reason: 'Stopped' });
    await expect(
      perpQuote(app, { id: perp, direction: 'short', margin: '10', leverage: '2' }, SOURCE),
    ).rejects.toMatchObject({ kind: 'refused', reason: 'trading_off' });
    await expect(
      perpQuote(app, { id: newId(), direction: 'long', margin: '10', leverage: '2' }, SOURCE),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it("on our own price, before any is stored, isn't set up here", async () => {
    const { rows } = await owner.query<{ any: boolean }>(
      "select exists (select 1 from prices.points where feed = 'btc-usd') as any",
    );
    if (rows[0]?.any) return; // Another file stored one first: nothing to see here.
    await expect(
      perpQuote(app, { id: BITCOIN, direction: 'long', margin: '10', leverage: '2' }, SOURCE),
    ).rejects.toBeInstanceOf(PerpNotSetUpError);
  });
});

describe('our own price', () => {
  it('reads the newest stored price and its history, each passing the contract', async () => {
    const { rows } = await owner.query<{ any: boolean }>(
      "select exists (select 1 from prices.points where feed = 'btc-usd') as any",
    );
    if (!rows[0]?.any) {
      await expect(latestPrice(app, 'btc-usd')).rejects.toBeInstanceOf(NoPriceYetError);
      await expect(priceHistory(app, 'btc-usd')).rejects.toBeInstanceOf(NoPriceYetError);
    }
    // Three prices a day old, five seconds apart: older than anything another file stores.
    await owner.query(
      `insert into prices.points (feed, at, price, sources, published_at)
       select 'btc-usd', now() - interval '1 day' + s * interval '5 seconds', 70000 + s, 3,
              now() - interval '1 day' + s * interval '5 seconds' + interval '300 milliseconds'
       from generate_series(0, 2) s
       on conflict do nothing`,
    );
    const newest = await latestPrice(app, 'btc-usd');
    await passes(outputOf(contract.prices.get), newest);
    const history = await priceHistory(app, 'btc-usd', '1m');
    await passes(outputOf(contract.prices.history), history);
    expect(history.points.map((point) => point.price)).toEqual(
      expect.arrayContaining(['70000.00', '70001.00', '70002.00']),
    );
    expect(history.points.at(-1)?.price).toBe(newest.price);
  });
});
