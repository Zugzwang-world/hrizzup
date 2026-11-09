import {
  cancelOrderResult,
  consoleMarketWithLog,
  marketList,
  ordersPage,
  positionsPage,
  restingOrder,
  tradeResult,
} from '@hrizzup/api/examples';
import { DatabaseBusyError } from '@hrizzup/db';
import { TradingError } from '@hrizzup/markets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The typed API's route (route.ts), for the markets' calls for everyone (PLAN.md step 1.7d), over
 * HTTP as any client sends them: what each answers, with which headers, and what runs before what.
 * The calls' work (`@hrizzup/markets`), who is signed in, the trades-a-minute limit and the edge are
 * stood in for; the database's part is tested with the database (product/packages/markets and
 * infra/supabase/tests).
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
// Made before the module stand-ins below, which vitest runs first.
const calls = vi.hoisted(() => ({
  marketList: vi.fn(),
  placeTrade: vi.fn(),
  cancelOrder: vi.fn(),
  positions: vi.fn(),
  openOrders: vi.fn(),
  openMarket: vi.fn(),
  closeMarket: vi.fn(),
  settleMarket: vi.fn(),
  createMarket: vi.fn(),
}));
const allowTrade = vi.fn();
const refreshEdge = vi.fn();
const pool = { connect: vi.fn() };

vi.mock('@/lib/api/context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => pool }));
vi.mock('@/lib/api/rate-limit.ts', () => ({
  allowTrade: (account: string) => allowTrade(account),
}));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  refreshEdge: (tags: string[]) => refreshEdge(tags),
}));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
  ...Object.fromEntries(
    Object.entries(calls).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
  ),
}));

const route = await import('./route.ts');

const SITE = 'https://staging.hrizzup.com';
const PERSON = { id: '00000000-0000-4000-8000-0000000000e1', email: 'ann@trading.test' };
const MARKET = tradeResult.marketId;
const REQUEST = '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a';

async function answer(method: 'GET' | 'POST', path: string, body?: unknown) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(
    new Request(`${SITE}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const buy = (changes: Record<string, unknown> = {}) => ({
  marketId: MARKET,
  requestId: REQUEST,
  action: 'buy',
  outcome: 'yes',
  amount: '25',
  ...changes,
});

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  signedIn.mockResolvedValue(PERSON);
  allowTrade.mockResolvedValue({ allowed: true });
  refreshEdge.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('the market list', () => {
  it('answers anyone, kept at the edge for a minute and tagged, reading nobody', async () => {
    signedIn.mockResolvedValue(null);
    calls.marketList.mockResolvedValue(marketList);
    const listed = await answer('GET', '/api/v1/markets');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual(marketList);
    expect(listed.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(listed.headers['vercel-cdn-cache-control']).toBe(
      'max-age=60, stale-while-revalidate=300',
    );
    expect(listed.headers['vercel-cache-tag']).toBe('markets');
    expect(calls.marketList).toHaveBeenCalledWith(pool, { after: undefined });
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('pages after a market, and refuses anything else sent, never kept', async () => {
    calls.marketList.mockResolvedValue(marketList);
    await answer('GET', `/api/v1/markets?after=${MARKET}`);
    expect(calls.marketList).toHaveBeenCalledWith(pool, { after: MARKET });
    for (const query of ['?unexpected=1', '?after=not-a-market']) {
      const refused = await answer('GET', `/api/v1/markets${query}`);
      expect(refused.status, query).toBe(400);
      expect(refused.headers['cache-control'], query).toBe('private, no-store');
      expect(refused.headers['vercel-cache-tag'], query).toBeUndefined();
    }
  });

  it('a busy database is "try again", never kept', async () => {
    calls.marketList.mockRejectedValue(new DatabaseBusyError());
    const busy = await answer('GET', '/api/v1/markets');
    expect(busy.status).toBe(503);
    expect(busy.headers['cache-control']).toBe('private, no-store');
    expect(busy.headers['vercel-cdn-cache-control']).toBeUndefined();
  });
});

describe('a trade', () => {
  it('answers the signed-in person with what the books did, never kept', async () => {
    calls.placeTrade.mockResolvedValue(tradeResult);
    const traded = await answer('POST', '/api/v1/trades', buy());
    expect(traded.status).toBe(200);
    expect(traded.body).toEqual(tradeResult);
    expect(traded.headers['cache-control']).toBe('private, no-store');
    expect(calls.placeTrade).toHaveBeenCalledWith(pool, PERSON.id, {
      marketId: MARKET,
      requestId: REQUEST,
      action: 'buy',
      outcome: 'yes',
      amount: '25',
    });
    expect(allowTrade).toHaveBeenCalledWith(PERSON.id);
  });

  it('clears the list at the edge when it moves the price, and not when an order only rests', async () => {
    calls.placeTrade.mockResolvedValue(tradeResult);
    await answer('POST', '/api/v1/trades', buy());
    expect(refreshEdge).toHaveBeenCalledWith(['markets']);
    refreshEdge.mockClear();
    calls.placeTrade.mockResolvedValue(restingOrder);
    await answer('POST', '/api/v1/trades', buy({ limitProb: '0.4' }));
    expect(refreshEdge).not.toHaveBeenCalled();
  });

  it('refuses, before anything runs: a limit outside 1% to 99%, an expiry of zero or past, an amount not above zero', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    for (const [what, sent] of [
      ['a limit of 0.5%', buy({ limitProb: '0.005' })],
      ['a limit of 99.5%', buy({ limitProb: '0.995' })],
      ['a limit of 100%', buy({ limitProb: '1' })],
      ['an expiry of zero', buy({ limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' })],
      ['an expiry of the number zero', buy({ limitProb: '0.4', expiresAt: 0 })],
      ['an expiry past', buy({ limitProb: '0.4', expiresAt: past })],
      [
        'an expiry without a limit',
        buy({ expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      ],
      ['an amount of zero', buy({ amount: '0' })],
      ['an amount below zero', buy({ amount: '-5' })],
      ['an amount as a number', buy({ amount: 25 })],
      ['shares of zero', { ...buy(), action: 'sell', amount: undefined, shares: '0' }],
      ['no request ID', buy({ requestId: undefined })],
    ] as const) {
      const refused = await answer('POST', '/api/v1/trades', sent);
      expect(refused.status, what).toBe(400);
      expect(refused.body?.code, what).toBe('BAD_REQUEST');
      expect(refused.headers['cache-control'], what).toBe('private, no-store');
    }
    expect(allowTrade).not.toHaveBeenCalled();
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it('refuses someone not signed in, counting nothing', async () => {
    signedIn.mockResolvedValue(null);
    const refused = await answer('POST', '/api/v1/trades', buy());
    expect(refused.status).toBe(401);
    expect(allowTrade).not.toHaveBeenCalled();
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it('refuses a person over their trades a minute, saying when to try again', async () => {
    allowTrade.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const limited = await answer('POST', '/api/v1/trades', buy());
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('17');
    expect(limited.headers['cache-control']).toBe('private, no-store');
    expect(limited.body).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      defined: true,
      data: { retryAfterSeconds: 17 },
    });
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it("answers the books' refusals with their reasons, and the rest by kind", async () => {
    const cases: [unknown, number, Record<string, unknown>][] = [
      [
        new TradingError('refused', 'That is more than your balance', 'insufficient_balance'),
        422,
        { code: 'REFUSED', defined: true, data: { reason: 'insufficient_balance' } },
      ],
      [
        new TradingError('refused', "This market isn't taking bets", 'market_not_open'),
        422,
        { code: 'REFUSED', data: { reason: 'market_not_open' } },
      ],
      [new TradingError('not_found', 'No such market'), 404, { code: 'NOT_FOUND' }],
      [new TradingError('conflict', 'Used already'), 409, { code: 'CONFLICT' }],
      [
        new TradingError('invalid', 'An expiry must be in the future'),
        400,
        { code: 'BAD_REQUEST' },
      ],
      [new DatabaseBusyError(), 503, { code: 'SERVICE_UNAVAILABLE' }],
    ];
    for (const [failure, status, body] of cases) {
      calls.placeTrade.mockRejectedValueOnce(failure);
      const refused = await answer('POST', '/api/v1/trades', buy());
      expect(refused.status, String(failure)).toBe(status);
      expect(refused.body, String(failure)).toMatchObject(body);
      expect(refused.headers['cache-control']).toBe('private, no-store');
    }
    expect(refreshEdge).not.toHaveBeenCalled();
  });
});

describe('cancelling an order', () => {
  const cancel = { marketId: MARKET, orderId: restingOrder.tradeId, requestId: REQUEST };

  it('answers the signed-in person, counts against the limit, and leaves the list alone', async () => {
    calls.cancelOrder.mockResolvedValue(cancelOrderResult);
    const cancelled = await answer('POST', '/api/v1/orders/cancel', cancel);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual(cancelOrderResult);
    expect(calls.cancelOrder).toHaveBeenCalledWith(pool, PERSON.id, cancel);
    expect(allowTrade).toHaveBeenCalledWith(PERSON.id);
    expect(refreshEdge).not.toHaveBeenCalled();
  });

  it('refuses an order that is not open, someone not signed in, and anyone over the limit', async () => {
    calls.cancelOrder.mockRejectedValueOnce(
      new TradingError('refused', 'No such open order', 'no_open_order'),
    );
    expect(await answer('POST', '/api/v1/orders/cancel', cancel)).toMatchObject({
      status: 422,
      body: { code: 'REFUSED', data: { reason: 'no_open_order' } },
    });
    allowTrade.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3 });
    expect((await answer('POST', '/api/v1/orders/cancel', cancel)).status).toBe(429);
    signedIn.mockResolvedValue(null);
    expect((await answer('POST', '/api/v1/orders/cancel', cancel)).status).toBe(401);
    expect(
      (await answer('POST', '/api/v1/orders/cancel', { ...cancel, orderId: 'not-an-id' })).status,
    ).toBe(400);
  });
});

describe("the person's own", () => {
  it('positions and open orders answer only someone signed in, never kept', async () => {
    calls.positions.mockResolvedValue(positionsPage);
    calls.openOrders.mockResolvedValue(ordersPage);
    const page = await answer('GET', '/api/v1/me/positions');
    expect(page).toMatchObject({ status: 200, body: positionsPage });
    expect(page.headers['cache-control']).toBe('private, no-store');
    expect(calls.positions).toHaveBeenCalledWith(pool, PERSON.id, { after: undefined });
    const orders = await answer('GET', `/api/v1/me/orders?after=${restingOrder.tradeId}`);
    expect(orders).toMatchObject({ status: 200, body: ordersPage });
    expect(calls.openOrders).toHaveBeenCalledWith(pool, PERSON.id, {
      after: restingOrder.tradeId,
    });
    signedIn.mockResolvedValue(null);
    expect((await answer('GET', '/api/v1/me/positions')).status).toBe(401);
    expect((await answer('GET', '/api/v1/me/orders')).status).toBe(401);
  });
});

describe("the console's changes clear the list at the edge", () => {
  it('opening, closing and settling a market do; making a draft does not', async () => {
    isAdmin.mockResolvedValue(true);
    for (const name of ['openMarket', 'closeMarket', 'settleMarket', 'createMarket'] as const) {
      calls[name].mockResolvedValue(consoleMarketWithLog);
    }
    const id = consoleMarketWithLog.id;
    await answer('POST', `/api/v1/admin/markets/${id}/open`);
    await answer('POST', `/api/v1/admin/markets/${id}/close`);
    await answer('POST', `/api/v1/admin/markets/${id}/settle`, {
      outcome: 'yes',
      evidence: 'The test desk recorded it.',
    });
    expect(refreshEdge).toHaveBeenCalledTimes(3);
    refreshEdge.mockClear();
    await answer('POST', '/api/v1/admin/markets', {
      id: '01a1ff00-0000-7000-8000-000000000001',
      question: 'Will test event Z happen?',
      categories: ['general'],
      rules: 'Rules.',
      source: { name: "Hrizzup's test desk" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(calls.createMarket).toHaveBeenCalled();
    expect(refreshEdge).not.toHaveBeenCalled();
  });
});
