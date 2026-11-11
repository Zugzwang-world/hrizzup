import {
  marketBook,
  marketHistory,
  marketQuote,
  marketTrades,
  oneMarket,
  perpDetails,
  perpQuote,
  price,
  priceHistory,
} from '@hrizzup/api/examples';
import { TradingError } from '@hrizzup/markets';
import { NoPriceYetError, PerpTradingError } from '@hrizzup/perps';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public API's market data at its addresses (PLAN.md steps 3.5c and 3.4b), the database stood in
 * for: each read answers anyone, with nobody signed in, kept at Vercel's edge briefly and tagged so a
 * trade clears it; a market or perp that isn't there is 404, a quote the trade would be refused is
 * 422 with its reason, and our price before the first is stored is 503. Against the real database:
 * product/packages/markets and product/packages/perps (data.db.test.ts); end to end: the journeys.
 */

const signedIn = vi.fn();
const calls = vi.hoisted(() => ({
  oneMarket: vi.fn(),
  marketHistory: vi.fn(),
  marketBook: vi.fn(),
  marketTrades: vi.fn(),
  marketQuote: vi.fn(),
}));
const perpCalls = vi.hoisted(() => ({
  perpQuote: vi.fn(),
  latestPrice: vi.fn(),
  priceHistory: vi.fn(),
}));
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));
vi.mock('@hrizzup/perps', async (original) => ({
  ...(await original<typeof import('@hrizzup/perps')>()),
  ...Object.fromEntries(
    Object.entries(perpCalls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';
const MARKET = marketQuote.marketId;
const PERP = perpDetails.id;

async function get(path: string) {
  const response = await (route.GET as (request: Request) => Promise<Response>)(
    new Request(`${SITE}${path}`),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('the market data', () => {
  it('answers anyone, reading nobody, each kept at the edge with its tag', async () => {
    calls.oneMarket.mockResolvedValue(oneMarket);
    calls.marketHistory.mockResolvedValue(marketHistory);
    calls.marketBook.mockResolvedValue(marketBook);
    calls.marketTrades.mockResolvedValue(marketTrades);
    calls.marketQuote.mockResolvedValue(marketQuote);
    const reads = [
      [`/api/v1/markets/${MARKET}`, oneMarket, 'max-age=60, stale-while-revalidate=300', 'markets'],
      [
        `/api/v1/markets/${MARKET}/history?range=1d`,
        marketHistory,
        'max-age=60, stale-while-revalidate=300',
        'markets',
      ],
      [
        `/api/v1/markets/${MARKET}/book`,
        marketBook,
        'max-age=10, stale-while-revalidate=60',
        'market-activity',
      ],
      [
        `/api/v1/markets/${MARKET}/trades?limit=10`,
        marketTrades,
        'max-age=10, stale-while-revalidate=60',
        'market-activity',
      ],
      [
        `/api/v1/markets/${MARKET}/quote?outcome=yes&amount=25`,
        marketQuote,
        'max-age=10, stale-while-revalidate=60',
        'market-activity',
      ],
    ] as const;
    for (const [path, body, edge, tag] of reads) {
      const read = await get(path);
      expect(read.status, path).toBe(200);
      expect(read.body, path).toEqual(body);
      expect(read.headers['cache-control'], path).toBe('public, max-age=0, must-revalidate');
      expect(read.headers['vercel-cdn-cache-control'], path).toBe(edge);
      expect(read.headers['vercel-cache-tag'], path).toBe(tag);
    }
    expect(calls.marketHistory).toHaveBeenCalledWith(pool, MARKET, '1d');
    expect(calls.marketTrades).toHaveBeenCalledWith(pool, MARKET, { cursor: undefined, limit: 10 });
    expect(calls.marketQuote).toHaveBeenCalledWith(pool, {
      id: MARKET,
      outcome: 'yes',
      amount: '25',
    });
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('answers 404 for no such market, 422 for a quote the trade would be refused, 400 for a bad cursor', async () => {
    calls.oneMarket.mockRejectedValue(new TradingError('not_found', 'No such market'));
    const missing = await get(`/api/v1/markets/${MARKET}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(missing.headers['cache-control']).toBe('private, no-store');

    calls.marketQuote.mockRejectedValue(
      new TradingError('refused', 'This market has closed', 'market_closed'),
    );
    const refused = await get(`/api/v1/markets/${MARKET}/quote?outcome=no&amount=5`);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'REFUSED', data: { reason: 'market_closed' } });

    calls.marketTrades.mockRejectedValue(
      new TradingError('invalid', 'Not a cursor from this list: send back the `next` it gave'),
    );
    const badCursor = await get(`/api/v1/markets/${MARKET}/trades?cursor=abc`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body).toMatchObject({ code: 'BAD_REQUEST', data: { issues: [{ path: '' }] } });
  });

  it('refuses a quote that is neither a buy of an amount nor a sale of shares, before anything runs', async () => {
    for (const query of [
      'outcome=yes',
      'outcome=yes&shares=5',
      'action=sell&outcome=no&amount=5',
      'outcome=maybe&amount=5',
      'outcome=yes&amount=5&limitProb=1.2',
    ]) {
      const refused = await get(`/api/v1/markets/${MARKET}/quote?${query}`);
      expect(refused.status, query).toBe(400);
      expect(refused.body, query).toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(calls.marketQuote).not.toHaveBeenCalled();
  });
});

describe("the perp's quote and our own price", () => {
  it('answer anyone, kept at the edge a few seconds', async () => {
    perpCalls.perpQuote.mockResolvedValue(perpQuote);
    perpCalls.latestPrice.mockResolvedValue(price);
    perpCalls.priceHistory.mockResolvedValue(priceHistory);
    const quoted = await get(`/api/v1/perps/${PERP}/quote?direction=long&margin=100&leverage=10`);
    expect(quoted.status).toBe(200);
    expect(quoted.body).toEqual(perpQuote);
    expect(quoted.headers['vercel-cdn-cache-control']).toBe('max-age=5, stale-while-revalidate=10');
    expect(quoted.headers['vercel-cache-tag']).toBe('perps');
    const newest = await get('/api/v1/prices/btc-usd');
    expect(newest.status).toBe(200);
    expect(newest.body).toEqual(price);
    expect(newest.headers['vercel-cdn-cache-control']).toBe('max-age=2, stale-while-revalidate=5');
    expect(newest.headers['vercel-cache-tag']).toBe('prices');
    const history = await get('/api/v1/prices/btc-usd/history?range=1h');
    expect(history.status).toBe(200);
    expect(perpCalls.priceHistory).toHaveBeenCalledWith(pool, 'btc-usd', '1h');
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('answer 503 before the first price, 422 for an open the perp would refuse, 404 for any other feed', async () => {
    perpCalls.latestPrice.mockRejectedValue(new NoPriceYetError());
    const none = await get('/api/v1/prices/btc-usd');
    expect(none.status).toBe(503);
    expect(none.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    perpCalls.perpQuote.mockRejectedValue(
      new PerpTradingError('refused', 'Leverage 11 is more than 10', 'leverage_too_high'),
    );
    const refused = await get(`/api/v1/perps/${PERP}/quote?direction=long&margin=100&leverage=11`);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'REFUSED', data: { reason: 'leverage_too_high' } });
    const other = await get('/api/v1/prices/eth-usd');
    expect(other.status).toBe(400);
  });
});
