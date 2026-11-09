import { standardSchema } from '@hrizzup/agreement';
import { createRouterClient, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { consoleMarketWithLog, createMarketInput, settleMarketInput } from './console.ts';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import { procedures as callsOf } from './procedures.ts';
import { standIn } from './stand-in.ts';
import { marketList, tradeInput } from './trading.ts';

const procedures = callsOf(contract);

describe('the contract', () => {
  it('gives every call a clean address of its own under /api/v1', () => {
    const seen = new Set<string>();
    for (const [name, procedure] of procedures) {
      const { method, path } = procedure['~orpc'].route;
      expect(method, `${name}'s method`).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(path, `${name}'s address`).toMatch(/^\/[a-z0-9/{}-]+$/);
      const key = `${method} ${path}`;
      expect(seen.has(key), `${key} is used twice`).toBe(false);
      seen.add(key);
    }
  });

  it('says how every answer may be kept: public reads only by GET, with a short edge life and tags', () => {
    for (const [name, procedure] of procedures) {
      const { caching } = procedure['~orpc'].meta;
      if (caching.kind === 'personal') continue;
      expect(procedure['~orpc'].route.method, `${name} is public, so it must be a GET`).toBe('GET');
      expect(caching.edgeSeconds).toBeGreaterThan(0);
      expect(caching.tags.length, `${name}'s cache tags`).toBeGreaterThan(0);
    }
    expect(contract.me['~orpc'].meta.caching.kind).toBe('personal');
    expect(contract.health['~orpc'].meta.caching.kind).toBe('public');
  });
});

describe('the stand-in implementation', () => {
  const api = createRouterClient(standIn());

  it('answers every call with its example, which passes the contract', async () => {
    await expect(api.health()).resolves.toEqual(examples.health);
    await expect(api.me()).resolves.toEqual(examples.me);
  });

  it('refuses any input a call does not take', async () => {
    const refused = api.health({ unexpected: '1' } as never);
    await expect(refused).rejects.toBeInstanceOf(ORPCError);
    await expect(refused).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers "not signed in" to who-am-I when nobody is', async () => {
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});

describe('the example content', () => {
  it("is the agreement's own examples, each passing its format's validator", async () => {
    for (const [format, records] of Object.entries(examples.content)) {
      expect(records.length, `${format} has examples`).toBeGreaterThan(0);
      for (const record of records) {
        const result = await standardSchema(format as keyof typeof examples.content)[
          '~standard'
        ].validate(record);
        expect(result.issues, `${format} ${(record as { id: string }).id}`).toBeUndefined();
      }
    }
  });
});

describe("the market console's calls", () => {
  const admin = procedures.filter(([name]) => name.startsWith('admin.'));

  it('are create, open, close and settle, with the two reads the console shows', () => {
    expect(admin.map(([name]) => name).sort()).toEqual([
      'admin.markets.close',
      'admin.markets.create',
      'admin.markets.get',
      'admin.markets.list',
      'admin.markets.open',
      'admin.markets.settle',
    ]);
  });

  it('are personal, never kept, under /admin/, and every write is a POST', () => {
    for (const [name, procedure] of admin) {
      const { route, meta } = procedure['~orpc'];
      expect(meta.caching, name).toEqual({ kind: 'personal' });
      expect(route.path, name).toMatch(/^\/admin\//);
      const reads = name.endsWith('.list') || name.endsWith('.get');
      expect(route.method, name).toBe(reads ? 'GET' : 'POST');
    }
  });
});

describe("a new market's input", () => {
  const hour = 3_600_000;
  const valid = {
    id: '019a6b3c-0001-7000-8000-000000000001',
    question: 'Will test event A happen before the end of the year?',
    categories: ['general', 'ai'],
    rules: 'Yes wins if the test desk records event A.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk" },
    opensAt: new Date(Date.now() + hour).toISOString(),
    closesAt: new Date(Date.now() + 24 * hour).toISOString(),
  };
  const refused = (change: Record<string, unknown>) =>
    !createMarketInput.safeParse({ ...valid, ...change }).success;

  it('takes a draft that keeps the agreement, starting at 50% with a seed of Ṁ1,000', () => {
    const parsed = createMarketInput.parse(valid);
    expect(parsed).toMatchObject({ probability: '0.5', seed: '1000' });
    expect(
      createMarketInput.safeParse({ ...valid, probability: '0.37', seed: '250.5' }).success,
    ).toBe(true);
  });

  it("refuses what the agreement refuses, by the agreement's own check", () => {
    expect(refused({ question: 'x'.repeat(121) })).toBe(true);
    expect(refused({ question: 'Two\nlines?' })).toBe(true);
    expect(refused({ question: 'Hidden\u200btext?' })).toBe(true);
    expect(refused({ rules: 'x'.repeat(2001) })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: 'http://insecure.example' } })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: '' } })).toBe(true);
    expect(refused({ categories: [] })).toBe(true);
    expect(refused({ categories: ['general', 'ai', 'sports', 'crypto'] })).toBe(true);
    expect(refused({ categories: ['general', 'general'] })).toBe(true);
    expect(refused({ categories: ['weather'] })).toBe(true);
    expect(refused({ id: '019a6b3c-0001-4000-8000-000000000001' })).toBe(true);
    expect(refused({ id: '019A6B3C-0001-7000-8000-000000000001' })).toBe(true);
    expect(refused({ extra: 'field' })).toBe(true);
  });

  it('refuses a closing time in the past, and an opening time at or after it', () => {
    expect(refused({ closesAt: new Date(Date.now() - hour).toISOString() })).toBe(true);
    expect(refused({ opensAt: valid.closesAt })).toBe(true);
  });

  it('refuses a starting probability outside 1% to 99%, and a seed of nothing or too much', () => {
    for (const probability of ['0.995', '0.005', '1', '0', '-0.5', '0.123456789']) {
      expect(refused({ probability }), probability).toBe(true);
    }
    for (const seed of ['0', '-5', '1000000.5', '2000000', '1.0000001']) {
      expect(refused({ seed }), seed).toBe(true);
    }
  });
});

describe("a settlement's input", () => {
  const id = '019a6b3c-0001-7000-8000-000000000001';
  const ok = (input: Record<string, unknown>) =>
    settleMarketInput.safeParse({ id, evidence: 'What the test desk recorded.', ...input }).success;

  it('takes Yes, No, a set probability with its probability, or a cancel with its reason', () => {
    expect(ok({ outcome: 'yes' })).toBe(true);
    expect(ok({ outcome: 'no' })).toBe(true);
    expect(ok({ outcome: 'probability', probability: '0.7' })).toBe(true);
    expect(ok({ outcome: 'cancel', reason: 'The test desk recorded nothing.' })).toBe(true);
  });

  it("refuses a probability or a reason where it doesn't belong, or missing where it does", () => {
    expect(ok({ outcome: 'probability' })).toBe(false);
    expect(ok({ outcome: 'yes', probability: '0.7' })).toBe(false);
    expect(ok({ outcome: 'probability', probability: '0.995' })).toBe(false);
    expect(ok({ outcome: 'cancel' })).toBe(false);
    expect(ok({ outcome: 'no', reason: 'A reason.' })).toBe(false);
    expect(ok({ outcome: 'maybe' })).toBe(false);
  });

  it('needs its evidence', () => {
    expect(settleMarketInput.safeParse({ id, outcome: 'yes' }).success).toBe(false);
    expect(ok({ outcome: 'yes', evidence: '' })).toBe(false);
  });
});

describe("the stand-in's market console", () => {
  it("answers an admin with the example market, built from the agreement's own example", async () => {
    const api = createRouterClient(standIn());
    const page = await api.admin.markets.list();
    expect(page).toEqual({ markets: [examples.consoleMarket], next: null });
    const market = await api.admin.markets.get({ id: examples.consoleMarketWithLog.id });
    expect(consoleMarketWithLog.parse(market)).toEqual(examples.consoleMarketWithLog);
    const [first] = examples.content['market/1'];
    expect(market).toMatchObject({ id: first?.id, question: first?.question, state: first?.state });
  });

  it("answers anyone but an admin, signed in or not, as an address the API doesn't have", async () => {
    for (const options of [{ admin: false }, { signedIn: false }]) {
      const api = createRouterClient(standIn(options));
      await expect(api.admin.markets.list()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'No such call',
      });
      await expect(
        api.admin.markets.get({ id: examples.consoleMarketWithLog.id }),
      ).rejects.toBeInstanceOf(ORPCError);
    }
  });
});

describe('the markets, for everyone', () => {
  const calls = procedures.filter(
    ([name]) => name.startsWith('markets.') || name.startsWith('portfolio.'),
  );

  it('are the list, trading, cancelling an order, positions and open orders', () => {
    expect(calls.map(([name]) => name).sort()).toEqual([
      'markets.cancelOrder',
      'markets.list',
      'markets.trade',
      'portfolio.orders',
      'portfolio.positions',
    ]);
  });

  it('keep only the list at the edge, tagged so a change clears it; the rest is never kept', () => {
    expect(contract.markets.list['~orpc'].meta.caching).toMatchObject({
      kind: 'public',
      tags: ['markets'],
    });
    expect(contract.markets.list['~orpc'].route.method).toBe('GET');
    for (const [name, procedure] of calls.filter(([name]) => name !== 'markets.list')) {
      expect(procedure['~orpc'].meta.caching, name).toEqual({ kind: 'personal' });
    }
    expect(contract.markets.trade['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/trades',
    });
    expect(contract.markets.cancelOrder['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/orders/cancel',
    });
  });

  it('say what a refused trade answers: a reason, a limit to wait out, or a busy database', () => {
    const errors = contract.markets.trade['~orpc'].errorMap;
    expect(errors.REFUSED?.status).toBe(422);
    expect(errors.TOO_MANY_REQUESTS?.status).toBe(429);
    expect(errors.UNAUTHORIZED?.status).toBe(401);
    expect(errors.NOT_FOUND?.status).toBe(404);
    expect(errors.CONFLICT?.status).toBe(409);
    expect(errors.SERVICE_UNAVAILABLE?.status).toBe(503);
  });
});

describe("a trade's input", () => {
  const hour = 3_600_000;
  const base = {
    marketId: examples.tradeResult.marketId,
    requestId: '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a',
  };
  const buy = { ...base, action: 'buy', outcome: 'yes', amount: '25' };
  const sell = { ...base, action: 'sell', outcome: 'no', shares: '10.5' };
  const takes = (input: Record<string, unknown>) => tradeInput.safeParse(input).success;

  it('takes a buy, a limit order with or without an expiry, and a sale', () => {
    expect(takes(buy)).toBe(true);
    expect(takes({ ...buy, outcome: 'no', amount: '0.000001' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.4' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.01' })).toBe(true);
    expect(takes({ ...buy, limitProb: '0.99' })).toBe(true);
    expect(
      takes({ ...buy, limitProb: '0.4', expiresAt: new Date(Date.now() + hour).toISOString() }),
    ).toBe(true);
    expect(takes(sell)).toBe(true);
  });

  it('refuses a limit outside 1% to 99%, or not written as a probability', () => {
    for (const limitProb of ['0.005', '0.995', '0.0099', '0.991', '1', '0', '-0.5', '1.5']) {
      expect(takes({ ...buy, limitProb }), limitProb).toBe(false);
    }
    for (const limitProb of ['0.123456789', '.5', '50%', '0.5 ', 0.5]) {
      expect(takes({ ...buy, limitProb }), String(limitProb)).toBe(false);
    }
  });

  it('refuses an expiry that is not a moment, and an expiry without a limit', () => {
    for (const expiresAt of [0, '0', '', 'tomorrow', '1970-01-01', 1_800_000_000_000]) {
      expect(takes({ ...buy, limitProb: '0.4', expiresAt }), String(expiresAt)).toBe(false);
    }
    expect(takes({ ...buy, expiresAt: new Date(Date.now() + hour).toISOString() })).toBe(false);
  });

  it("leaves an expiry that isn't in the future (zero included) to the server, which checks it unless the request was already answered", async () => {
    // A retried limit order's expiry may have passed by the time it's retried: the server's check
    // (`checkBefore` in @hrizzup/markets) gives the books' first answer instead. The stand-in, with
    // no answer to give back, always refuses it.
    const zero = { ...buy, limitProb: '0.4', expiresAt: '1970-01-01T00:00:00Z' };
    expect(takes(zero)).toBe(true);
    const api = createRouterClient(standIn());
    for (const expiresAt of ['1970-01-01T00:00:00Z', new Date(Date.now() - 1000).toISOString()]) {
      await expect(
        api.markets.trade({ ...zero, expiresAt } as Parameters<typeof api.markets.trade>[0]),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
    }
  });

  it("refuses an amount or shares that isn't more than zero, or isn't exact", () => {
    for (const amount of ['0', '0.0', '0.000000', '-5', '-0.000001', 'abc', '', '1e3', ' 5']) {
      expect(takes({ ...buy, amount }), amount).toBe(false);
    }
    for (const amount of [5, 0, -5, '1.0000001', '01', '123456789012345']) {
      expect(takes({ ...buy, amount }), String(amount)).toBe(false);
    }
    for (const shares of ['0', '-1', 'all', '0.0000001']) {
      expect(takes({ ...sell, shares }), shares).toBe(false);
    }
  });

  it('refuses anything else it was not built to take', () => {
    expect(takes({ ...buy, action: 'short' })).toBe(false);
    expect(takes({ ...buy, outcome: 'YES' })).toBe(false);
    expect(takes({ ...buy, outcome: 'maybe' })).toBe(false);
    expect(takes({ ...buy, requestId: 'retry-1' })).toBe(false);
    expect(takes({ ...buy, marketId: '01A1AB94-8600-7B23-BA8B-9E3174889404' })).toBe(false);
    expect(takes({ ...buy, shares: '1' })).toBe(false);
    expect(takes({ ...sell, amount: '1' })).toBe(false);
    expect(takes({ ...sell, limitProb: '0.4' })).toBe(false);
    expect(takes({ ...buy, extra: 'field' })).toBe(false);
    const { requestId: _requestId, ...noRequestId } = buy;
    expect(takes(noRequestId)).toBe(false);
  });
});

describe("the stand-in's markets", () => {
  const api = createRouterClient(standIn());

  it("lists the agreement's example markets but the draft, newest first, each passing the agreement's check", async () => {
    const page = await api.markets.list();
    expect(marketList.parse(page)).toEqual(examples.marketList);
    const ids = page.markets.map((item) => item.market.id);
    expect(ids).toEqual([...ids].sort().reverse());
    const records = examples.content['market/1'];
    expect(ids.sort()).toEqual(
      records
        .filter((record) => record.state !== 'draft')
        .map((record) => record.id)
        .sort(),
    );
    for (const item of page.markets) {
      const result = await standardSchema('market/1')['~standard'].validate(item.market);
      expect(result.issues, item.market.id).toBeUndefined();
    }
  });

  it('answers trading, a cancel, positions and open orders with examples that pass the contract', async () => {
    const trade = {
      marketId: examples.tradeResult.marketId,
      requestId: examples.tradeResult.requestId,
    };
    await expect(
      api.markets.trade({ ...trade, action: 'buy', outcome: 'yes', amount: '25' }),
    ).resolves.toEqual(examples.tradeResult);
    await expect(
      api.markets.trade({
        ...trade,
        requestId: examples.restingOrder.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '10',
        limitProb: '0.4',
      }),
    ).resolves.toEqual(examples.restingOrder);
    await expect(
      api.markets.trade({ ...trade, action: 'sell', outcome: 'yes', shares: '49.390243' }),
    ).resolves.toMatchObject({ status: 'filled', shares: '-49.390243' });
    await expect(
      api.markets.cancelOrder({
        marketId: trade.marketId,
        orderId: examples.restingOrder.tradeId,
        requestId: examples.cancelOrderResult.requestId,
      }),
    ).resolves.toEqual(examples.cancelOrderResult);
    await expect(api.portfolio.positions()).resolves.toEqual(examples.positionsPage);
    await expect(api.portfolio.orders()).resolves.toEqual(examples.ordersPage);
  });

  it('answers "not signed in" to trading and the portfolio when nobody is, but lists the markets', async () => {
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.markets.list()).resolves.toEqual(examples.marketList);
    await expect(
      signedOut.markets.trade({
        marketId: examples.tradeResult.marketId,
        requestId: examples.tradeResult.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '25',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    await expect(signedOut.portfolio.positions()).rejects.toMatchObject({ status: 401 });
    await expect(signedOut.portfolio.orders()).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an input a trading call does not take before it answers', async () => {
    await expect(
      api.markets.trade({
        marketId: examples.tradeResult.marketId,
        requestId: examples.tradeResult.requestId,
        action: 'buy',
        outcome: 'yes',
        amount: '25',
        limitProb: '0.995',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', status: 400 });
  });
});
