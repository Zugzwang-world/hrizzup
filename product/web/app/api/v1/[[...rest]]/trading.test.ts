import {
  cancelOrderResult,
  consoleMarketWithLog,
  dryRunResult,
  marketList,
  myTradesPage,
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
  myTrades: vi.fn(),
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
vi.mock('@/lib/api/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('@/lib/api/rate-limit.ts')>()),
  allowTrade: (account: string) => allowTrade(account),
}));
vi.mock('@/lib/api/edge-cache.ts', () => ({
  MARKETS_TAG: 'markets',
  MARKET_ACTIVITY_TAG: 'market-activity',
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

async function answer(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const handler = route[method] as (request: Request) => Promise<Response>;
  const response = await handler(
    new Request(`${SITE}${path}`, {
      method,
      ...(body === undefined
        ? { headers }
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json', ...headers },
          }),
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
    expect(calls.marketList).toHaveBeenCalledWith(pool, { after: undefined }, expect.any(Function));
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('pages by cursor and limit, and refuses anything else sent in the one format, never kept', async () => {
    calls.marketList.mockResolvedValue(marketList);
    await answer('GET', `/api/v1/markets?cursor=${MARKET}`);
    expect(calls.marketList).toHaveBeenCalledWith(
      pool,
      { after: MARKET, limit: undefined },
      expect.any(Function),
    );
    await answer('GET', `/api/v1/markets?cursor=${MARKET}&limit=20`);
    expect(calls.marketList).toHaveBeenLastCalledWith(
      pool,
      { after: MARKET, limit: 20 },
      expect.any(Function),
    );
    for (const [query, path] of [
      ['?unexpected=1', ''],
      [`?after=${MARKET}`, ''],
      ['?cursor=not-a-market', 'cursor'],
      ['?limit=0', 'limit'],
      ['?limit=101', 'limit'],
      ['?limit=2.5', 'limit'],
      ['?limit=many', 'limit'],
    ]) {
      const refused = await answer('GET', `/api/v1/markets${query}`);
      expect(refused.status, query).toBe(400);
      expect(refused.headers['cache-control'], query).toBe('private, no-store');
      expect(refused.headers['vercel-cache-tag'], query).toBeUndefined();
      expect(refused.body, query).toMatchObject({
        defined: true,
        code: 'BAD_REQUEST',
        status: 400,
      });
      const data = refused.body?.data as { issues: { path: string; message: string }[] };
      const issues = data.issues;
      expect(issues.length, query).toBeGreaterThan(0);
      if (path)
        expect(
          issues.map((issue) => issue.path),
          query,
        ).toContain(path);
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

  it('clears the list, the market, its history and its activity at the edge on every trade', async () => {
    calls.placeTrade.mockResolvedValue(tradeResult);
    await answer('POST', '/api/v1/trades', buy());
    expect(refreshEdge).toHaveBeenCalledTimes(1);
    expect(refreshEdge).toHaveBeenCalledWith(['markets', 'market-activity']);
    refreshEdge.mockClear();
    // An order that only rests adds a point to the history (at the same price) and a row to the book.
    calls.placeTrade.mockResolvedValue(restingOrder);
    await answer('POST', '/api/v1/trades', buy({ limitProb: '0.4' }));
    expect(refreshEdge).toHaveBeenCalledTimes(1);
    expect(refreshEdge).toHaveBeenCalledWith(['markets', 'market-activity']);
  });

  it('refuses, before anything runs: a limit outside 1% to 99%, an amount not above zero, an expiry that is no moment', async () => {
    for (const [what, sent] of [
      ['a limit of 0.5%', buy({ limitProb: '0.005' })],
      ['a limit of 99.5%', buy({ limitProb: '0.995' })],
      ['a limit of 100%', buy({ limitProb: '1' })],
      ['an expiry of the number zero', buy({ limitProb: '0.4', expiresAt: 0 })],
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

  describe('through the real call, with the database stood in for', () => {
    /** A database connection answering the holdings read and the books' start of a trade. */
    function database(answered: boolean, replay?: unknown) {
      const sent: string[] = [];
      const client = {
        query: vi.fn(async (text: string) => {
          sent.push(text);
          if (text.includes('trading.holdings')) {
            return {
              rows: [
                {
                  answer: {
                    market_id: MARKET,
                    state: 'open',
                    closes_at: '2099-01-01T00:00:00Z',
                    has_account: true,
                    balance: '100.000000',
                    yes: '0.000000',
                    no: '0.000000',
                    answered,
                  },
                },
              ],
            };
          }
          if (text.includes('markets.begin_trade')) return { rows: [{ state: { replay } }] };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      pool.connect.mockResolvedValue(client);
      return sent;
    }

    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('@hrizzup/markets')>('@hrizzup/markets');
      calls.placeTrade.mockImplementation(actual.placeTrade);
    });

    it('refuses an expiry of zero, or one already past, before the books are touched', async () => {
      const sent = database(false);
      for (const expiresAt of [
        '1970-01-01T00:00:00Z',
        new Date(Date.now() - 60_000).toISOString(),
      ]) {
        const refused = await answer(
          'POST',
          '/api/v1/trades',
          buy({ limitProb: '0.4', expiresAt }),
        );
        expect(refused.status, expiresAt).toBe(400);
        expect(refused.body, expiresAt).toMatchObject({
          code: 'BAD_REQUEST',
          message: 'An expiry must be in the future',
        });
      }
      expect(sent.some((text) => text.includes('trading.holdings'))).toBe(true);
      expect(sent.some((text) => text.includes('markets.begin_trade'))).toBe(false);
    });

    it("answers a retry of a request already answered with the books' first answer, even after its expiry passed", async () => {
      const first = {
        status: 'resting',
        request_id: REQUEST,
        market_id: MARKET,
        trade_id: restingOrder.tradeId,
        number: 2,
        outcome: 'YES',
        amount: '0.000000',
        shares: '0.000000',
        order_amount: '10.000000',
        limit_prob: '0.40000000',
        prob_before: '0.51234380',
        prob_after: '0.51234380',
        balance: '975.000000',
        position: { yes: '49.390243', no: '0.000000' },
        at: '2026-11-09T07:20:00+00:00',
      };
      database(true, first);
      const retried = await answer(
        'POST',
        '/api/v1/trades',
        buy({ amount: '10', limitProb: '0.4', expiresAt: '2026-11-09T08:00:00Z' }),
      );
      expect(retried.status).toBe(200);
      // The same answer; its moment written as the API writes every one (with milliseconds).
      expect(retried.body).toEqual({
        ...restingOrder,
        requestId: REQUEST,
        at: '2026-11-09T07:20:00.000Z',
      });
    });
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

  it("answers the signed-in person, counts against the limit, and clears only the market's book", async () => {
    calls.cancelOrder.mockResolvedValue(cancelOrderResult);
    const cancelled = await answer('POST', '/api/v1/orders/cancel', cancel);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual(cancelOrderResult);
    expect(calls.cancelOrder).toHaveBeenCalledWith(pool, PERSON.id, cancel);
    expect(allowTrade).toHaveBeenCalledWith(PERSON.id);
    expect(refreshEdge).toHaveBeenCalledTimes(1);
    expect(refreshEdge).toHaveBeenCalledWith(['market-activity']);
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
    const orders = await answer('GET', `/api/v1/me/orders?cursor=${restingOrder.tradeId}&limit=5`);
    expect(orders).toMatchObject({ status: 200, body: ordersPage });
    expect(calls.openOrders).toHaveBeenCalledWith(pool, PERSON.id, {
      after: restingOrder.tradeId,
      limit: 5,
    });
    signedIn.mockResolvedValue(null);
    expect((await answer('GET', '/api/v1/me/positions')).status).toBe(401);
    expect((await answer('GET', '/api/v1/me/orders')).status).toBe(401);
  });

  it('their own trades (Manifold’s bets) answer only someone signed in, a page at a time, never kept', async () => {
    calls.myTrades.mockResolvedValue(myTradesPage);
    const page = await answer('GET', `/api/v1/me/trades?cursor=${restingOrder.tradeId}&limit=5`);
    expect(page).toMatchObject({ status: 200, body: myTradesPage });
    expect(page.headers['cache-control']).toBe('private, no-store');
    expect(calls.myTrades).toHaveBeenCalledWith(pool, PERSON.id, {
      after: restingOrder.tradeId,
      limit: 5,
    });
    signedIn.mockResolvedValue(null);
    expect((await answer('GET', '/api/v1/me/trades')).status).toBe(401);
  });
});

describe('a dry run', () => {
  it("answers what the trade would do, takes Manifold's YES, counts against the limit, and clears nothing at the edge", async () => {
    calls.placeTrade.mockResolvedValue(dryRunResult);
    const dry = await answer('POST', '/api/v1/trades', buy({ outcome: 'YES', dryRun: true }));
    expect(dry).toMatchObject({ status: 200, body: dryRunResult });
    expect(dry.headers['cache-control']).toBe('private, no-store');
    expect(calls.placeTrade).toHaveBeenCalledWith(pool, PERSON.id, {
      marketId: MARKET,
      requestId: REQUEST,
      action: 'buy',
      outcome: 'yes',
      amount: '25',
      dryRun: true,
    });
    expect(allowTrade).toHaveBeenCalledWith(PERSON.id);
    expect(refreshEdge).not.toHaveBeenCalled();
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
    for (const call of refreshEdge.mock.calls)
      expect(call).toEqual([['markets', 'market-activity']]);
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

describe('a write from another site', () => {
  it('is refused before anything runs, when it would ride on the session cookie', async () => {
    calls.placeTrade.mockResolvedValue(tradeResult);
    for (const [what, headers] of [
      ['another site', { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' }],
      [
        'another of our subdomains',
        { origin: 'https://media.hrizzup.com', 'sec-fetch-site': 'same-site' },
      ],
      ['an older browser naming another site', { origin: 'https://elsewhere.example' }],
    ] as const) {
      const refused = await answer('POST', '/api/v1/trades', buy(), headers);
      expect(refused.status, what).toBe(403);
      expect(refused.body, what).toMatchObject({ code: 'FORBIDDEN' });
      expect(refused.headers['cache-control'], what).toBe('private, no-store');
      const cancel = { marketId: MARKET, orderId: restingOrder.tradeId, requestId: REQUEST };
      expect((await answer('POST', '/api/v1/orders/cancel', cancel, headers)).status, what).toBe(
        403,
      );
    }
    expect(signedIn).not.toHaveBeenCalled();
    expect(allowTrade).not.toHaveBeenCalled();
    expect(calls.placeTrade).not.toHaveBeenCalled();
  });

  it('goes through from this site, from a client that is not a browser, or with its own token', async () => {
    calls.placeTrade.mockResolvedValue(tradeResult);
    const allowed: Record<string, string>[] = [
      { origin: SITE, 'sec-fetch-site': 'same-origin' },
      { origin: SITE },
      {},
      { authorization: 'Bearer a-token', origin: 'https://elsewhere.example' },
    ];
    for (const headers of allowed) {
      expect((await answer('POST', '/api/v1/trades', buy(), headers)).status).toBe(200);
    }
  });

  it('never stops a read: the list stays public', async () => {
    calls.marketList.mockResolvedValue(marketList);
    const listed = await answer('GET', '/api/v1/markets', undefined, {
      origin: 'https://elsewhere.example',
      'sec-fetch-site': 'cross-site',
    });
    expect(listed.status).toBe(200);
  });
});
