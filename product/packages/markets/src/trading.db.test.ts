import { randomUUID } from 'node:crypto';
import type { CreateMarketInput, TradeInput } from '@hrizzup/api';
import { contract } from '@hrizzup/api';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMarket, createMarket, openMarket, settleMarket } from './console.ts';
import {
  cancelOrder,
  marketList,
  openOrders,
  placeTrade,
  positions,
  TradingError,
} from './trading.ts';

/**
 * The markets' calls for everyone (PLAN.md step 1.7d) against a real database built from the
 * migrations (the Database check), through the server's one database helper, as the app's own role:
 * the list anyone may read, trades through the ledger's own `trade()` (buys, sales, limit orders,
 * cancels, retries), the refusals made before the books are touched (nothing written for them), and
 * the person's own positions and open orders. The answers are checked against the contract's own
 * shapes, and the books against `ledger.problems()`.
 */

const url = process.env.MARKETS_DATABASE_URL;
if (!url) throw new Error('MARKETS_DATABASE_URL is not set: run `pnpm test:db`');

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
    `${ADMIN}@trading.test`,
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

function draft(changes: Partial<CreateMarketInput> = {}): CreateMarketInput {
  return {
    id: newId(),
    question: 'Will test event T happen before the end of the year?',
    categories: ['general'],
    rules: 'Yes wins if the test desk records event T.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    probability: '0.5',
    seed: '1000',
    ...changes,
  };
}

/** A market an admin has made and opened, at 50% with Ṁ1,000 from the house. */
async function openedMarket(): Promise<string> {
  const made = await createMarket(app, ADMIN, draft());
  await openMarket(app, ADMIN, made.id);
  return made.id;
}

/** Someone signed in: with a starting balance from the house, or (null) no play money yet. */
async function person(starting: string | null): Promise<string> {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@trading.test`,
  ]);
  if (starting !== null)
    await owner.query('select ledger.open_account($1, $2)', [userId, starting]);
  return userId;
}

/** Whether the books hold anything for a request ID: a stored answer, or a trade. */
async function written(requestId: string): Promise<boolean> {
  const { rows } = await owner.query<{ found: boolean }>(
    `select exists (select 1 from markets.requests where id = $1)
         or exists (select 1 from markets.trades where request_id = $1) as found`,
    [requestId],
  );
  return rows[0]?.found === true;
}

async function balanceOf(userId: string): Promise<string> {
  return (await positions(app, userId)).balance;
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

function buy(marketId: string, changes: Partial<Extract<TradeInput, { action: 'buy' }>> = {}) {
  return {
    marketId,
    requestId: randomUUID(),
    action: 'buy' as const,
    outcome: 'yes' as const,
    amount: '10',
    ...changes,
  };
}

async function refusal(work: Promise<unknown>): Promise<TradingError> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(TradingError);
  return error as TradingError;
}

describe('the list anyone may see', () => {
  it('shows open markets newest first, never a draft, each the agreement record with its probability', async () => {
    const older = await openedMarket();
    const newer = await openedMarket();
    const hidden = (await createMarket(app, ADMIN, draft())).id;
    const page = await marketList(app);
    await passes(outputOf(contract.markets.list), page);
    const ids = page.markets.map((item) => item.market.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(ids).not.toContain(hidden);
    // The contract's list (just checked) holds each market to the agreement's own check.
    expect(page.markets.find((item) => item.market.id === newer)).toMatchObject({
      market: { state: 'open', kind: 'yes_no' },
      probability: '0.50000000',
    });
    const after = await marketList(app, { after: newer });
    expect(after.markets.map((item) => item.market.id)).toContain(older);
    expect(after.markets.map((item) => item.market.id)).not.toContain(newer);
  });

  it("shows a trade's new probability, and a settled market's result with none", async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const traded = await placeTrade(app, trader, buy(market, { amount: '25' }));
    let listed = (await marketList(app)).markets.find((item) => item.market.id === market);
    expect(listed?.probability).toBe(traded.probAfter);
    expect(Number(listed?.probability)).toBeGreaterThan(0.5);
    await closeMarket(app, ADMIN, market);
    await settleMarket(app, ADMIN, { id: market, outcome: 'yes', evidence: 'The desk said yes.' });
    listed = (await marketList(app)).markets.find((item) => item.market.id === market);
    expect(listed).toMatchObject({
      market: { state: 'settled', result: 'yes' },
      probability: null,
    });
  });
});

describe('trading', () => {
  it('buys, answers a retry with the first answer, and sells back', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market, { amount: '25' });
    const bought = await placeTrade(app, trader, request);
    await passes(outputOf(contract.markets.trade), bought);
    expect(bought).toMatchObject({
      status: 'filled',
      requestId: request.requestId,
      marketId: market,
      outcome: 'yes',
      amount: '25.000000',
      orderAmount: '25.000000',
      limitProb: null,
      probBefore: '0.50000000',
      balance: '75.000000',
    });
    expect(Number(bought.shares)).toBeGreaterThan(25);
    expect(bought.position.yes).toBe(bought.shares);

    // The same request again: the first answer, and no second trade.
    await expect(placeTrade(app, trader, request)).resolves.toEqual(bought);
    expect(await balanceOf(trader)).toBe('75.000000');

    const sold = await placeTrade(app, trader, {
      marketId: market,
      requestId: randomUUID(),
      action: 'sell',
      outcome: 'yes',
      shares: bought.shares,
    });
    await passes(outputOf(contract.markets.trade), sold);
    expect(sold.status).toBe('filled');
    expect(Number(sold.amount)).toBeLessThan(0);
    expect(Number(sold.shares)).toBeLessThan(0);
    expect(Number(sold.balance)).toBeGreaterThan(99.99);
    expect(Number(sold.position.yes)).toBeLessThan(0.000002);
  });

  it('places a limit order that rests, shows it among the open orders, and cancels it', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const resting = await placeTrade(
      app,
      trader,
      buy(market, {
        amount: '10',
        limitProb: '0.3',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    await passes(outputOf(contract.markets.trade), resting);
    expect(resting).toMatchObject({
      status: 'resting',
      amount: '0.000000',
      shares: '0.000000',
      orderAmount: '10.000000',
      limitProb: '0.30000000',
      balance: '100.000000',
    });
    const orders = await openOrders(app, trader);
    await passes(outputOf(contract.portfolio.orders), orders);
    expect(orders.orders).toEqual([
      expect.objectContaining({
        id: resting.tradeId,
        marketId: market,
        outcome: 'yes',
        orderAmount: '10.000000',
        amount: '0.000000',
        limitProb: '0.30000000',
        state: 'open',
      }),
    ]);
    expect(orders.orders[0]?.expiresAt).not.toBeNull();

    const cancel = { marketId: market, orderId: resting.tradeId, requestId: randomUUID() };
    const cancelled = await cancelOrder(app, trader, cancel);
    await passes(outputOf(contract.markets.cancelOrder), cancelled);
    expect(cancelled).toEqual({ status: 'cancelled', ...cancel });
    // A retry of the same cancel answers the same.
    await expect(cancelOrder(app, trader, cancel)).resolves.toEqual(cancelled);
    expect((await openOrders(app, trader)).orders).toEqual([]);
    const again = await refusal(cancelOrder(app, trader, { ...cancel, requestId: randomUUID() }));
    expect(again).toMatchObject({ kind: 'refused', reason: 'no_open_order' });
  });

  it("never cancels someone else's order", async () => {
    const market = await openedMarket();
    const [ann, raj] = [await person('100'), await person('100')];
    const order = await placeTrade(app, ann, buy(market, { limitProb: '0.2' }));
    const stranger = await refusal(
      cancelOrder(app, raj, { marketId: market, orderId: order.tradeId, requestId: randomUUID() }),
    );
    expect(stranger).toMatchObject({ kind: 'refused', reason: 'no_open_order' });
    expect((await openOrders(app, ann)).orders.map((o) => o.id)).toEqual([order.tradeId]);
  });

  it('refuses a request ID used again for a different request', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market);
    await placeTrade(app, trader, request);
    const reused = await refusal(placeTrade(app, trader, { ...request, amount: '11' }));
    expect(reused.kind).toBe('conflict');
  });
});

describe('refused before the books are touched', () => {
  it('an amount over the balance, with nothing written', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market, { amount: '100.000001' });
    const error = await refusal(placeTrade(app, trader, request));
    expect(error).toMatchObject({ kind: 'refused', reason: 'insufficient_balance' });
    expect(await written(request.requestId)).toBe(false);
    expect(await balanceOf(trader)).toBe('100.000000');
    // A limit order may spend no more than the balance either.
    const limit = buy(market, { amount: '150', limitProb: '0.2' });
    await expect(refusal(placeTrade(app, trader, limit))).resolves.toMatchObject({
      reason: 'insufficient_balance',
    });
    expect(await written(limit.requestId)).toBe(false);
    // Exactly the balance is fine.
    await expect(placeTrade(app, trader, buy(market, { amount: '100' }))).resolves.toMatchObject({
      status: 'filled',
      balance: '0.000000',
    });
  });

  it('shares over what is held, with nothing written', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const bought = await placeTrade(app, trader, buy(market, { outcome: 'no', amount: '10' }));
    const request = {
      marketId: market,
      requestId: randomUUID(),
      action: 'sell' as const,
      outcome: 'no' as const,
      shares: (Number(bought.shares) + 1).toFixed(6),
    };
    await expect(refusal(placeTrade(app, trader, request))).resolves.toMatchObject({
      reason: 'not_enough_shares',
    });
    expect(await written(request.requestId)).toBe(false);
    const wrongSide = { ...request, requestId: randomUUID(), outcome: 'yes' as const, shares: '1' };
    await expect(refusal(placeTrade(app, trader, wrongSide))).resolves.toMatchObject({
      reason: 'not_enough_shares',
    });
    expect(await written(wrongSide.requestId)).toBe(false);
  });

  it('someone with no play money yet, with nothing written', async () => {
    const market = await openedMarket();
    const newcomer = await person(null);
    const request = buy(market, { amount: '1' });
    await expect(refusal(placeTrade(app, newcomer, request))).resolves.toMatchObject({
      reason: 'insufficient_balance',
    });
    const cancel = { marketId: market, orderId: randomUUID(), requestId: randomUUID() };
    await expect(refusal(cancelOrder(app, newcomer, cancel))).resolves.toMatchObject({
      reason: 'no_open_order',
    });
    expect(await written(request.requestId)).toBe(false);
    expect(await written(cancel.requestId)).toBe(false);
    await expect(positions(app, newcomer)).resolves.toEqual({
      balance: '0.000000',
      positions: [],
      next: null,
    });
    await expect(openOrders(app, newcomer)).resolves.toEqual({ orders: [], next: null });
  });

  it('a market that is closed, a draft, or none at all, with nothing written', async () => {
    const trader = await person('100');
    const closed = await openedMarket();
    await closeMarket(app, ADMIN, closed);
    const request = buy(closed);
    await expect(refusal(placeTrade(app, trader, request))).resolves.toMatchObject({
      reason: 'market_not_open',
    });
    expect(await written(request.requestId)).toBe(false);
    const draftMarket = (await createMarket(app, ADMIN, draft())).id;
    const onDraft = buy(draftMarket);
    await expect(refusal(placeTrade(app, trader, onDraft))).resolves.toMatchObject({
      kind: 'not_found',
    });
    const nowhere = buy(newId());
    await expect(refusal(placeTrade(app, trader, nowhere))).resolves.toMatchObject({
      kind: 'not_found',
    });
    expect(await written(onDraft.requestId)).toBe(false);
    expect(await written(nowhere.requestId)).toBe(false);
  });

  it("a market past its closing time, by the server's clock", async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market);
    const later = Date.now() + 2 * 86_400_000;
    await expect(refusal(placeTrade(app, trader, request, later))).resolves.toMatchObject({
      reason: 'market_closed',
    });
    expect(await written(request.requestId)).toBe(false);
  });
});

describe('a retry gets its first answer, whatever has changed since', () => {
  it('after the whole balance was spent', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market, { amount: '100' });
    const first = await placeTrade(app, trader, request);
    expect(first).toMatchObject({ status: 'filled', balance: '0.000000' });
    await expect(placeTrade(app, trader, request)).resolves.toEqual(first);
  });

  it('after every share was sold', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const bought = await placeTrade(app, trader, buy(market, { amount: '10' }));
    const sale = {
      marketId: market,
      requestId: randomUUID(),
      action: 'sell' as const,
      outcome: 'yes' as const,
      shares: bought.shares,
    };
    const first = await placeTrade(app, trader, sale);
    expect(first.status).toBe('filled');
    await expect(placeTrade(app, trader, sale)).resolves.toEqual(first);
  });

  it('after the market closed, and after it was settled', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market, { amount: '10' });
    const first = await placeTrade(app, trader, request);
    await closeMarket(app, ADMIN, market);
    await expect(placeTrade(app, trader, request)).resolves.toEqual(first);
    await settleMarket(app, ADMIN, { id: market, outcome: 'no', evidence: 'The desk said no.' });
    await expect(placeTrade(app, trader, request)).resolves.toEqual(first);
  });

  it("after a limit order's expiry passed, and its cancel after it", async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const order = buy(market, {
      amount: '10',
      limitProb: '0.2',
      expiresAt: new Date(Date.now() + 1500).toISOString(),
    });
    const first = await placeTrade(app, trader, order);
    expect(first.status).toBe('resting');
    const cancel = { marketId: market, orderId: first.tradeId, requestId: randomUUID() };
    const cancelled = await cancelOrder(app, trader, cancel);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await expect(placeTrade(app, trader, order)).resolves.toEqual(first);
    await expect(cancelOrder(app, trader, cancel)).resolves.toEqual(cancelled);
  });

  it('but a request ID sent again for a different request is refused as one, whatever it asks', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const request = buy(market, { amount: '10' });
    await placeTrade(app, trader, request);
    const overBalance = await refusal(placeTrade(app, trader, { ...request, amount: '1000' }));
    expect(overBalance.kind).toBe('conflict');
    const elsewhere = await refusal(
      placeTrade(app, trader, { ...request, marketId: await openedMarket() }),
    );
    expect(elsewhere.kind).toBe('conflict');
  });
});

describe('an expiry that is not in the future', () => {
  it('is refused before the books, zero included, with nothing written', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    for (const expiresAt of ['1970-01-01T00:00:00Z', new Date(Date.now() - 1000).toISOString()]) {
      const request = buy(market, { limitProb: '0.3', expiresAt });
      await expect(refusal(placeTrade(app, trader, request))).resolves.toMatchObject({
        kind: 'invalid',
        message: 'An expiry must be in the future',
      });
      expect(await written(request.requestId)).toBe(false);
    }
  });
});

describe('the books still check everything themselves', () => {
  it('refuse a second buy that the balance no longer covers, made at the same moment', async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const results = await Promise.allSettled([
      placeTrade(app, trader, buy(market, { amount: '60' })),
      placeTrade(app, trader, buy(market, { amount: '60' })),
    ]);
    const filled = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(filled).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({
      kind: 'refused',
      reason: 'insufficient_balance',
    });
    expect(await balanceOf(trader)).toBe('40.000000');
  });

  it("refuse a limit order whose expiry has passed by the database's clock", async () => {
    const market = await openedMarket();
    const trader = await person('100');
    const soon = new Date(Date.now() + 50).toISOString();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const error = await refusal(
      placeTrade(app, trader, buy(market, { limitProb: '0.3', expiresAt: soon })),
    );
    expect(error.kind).toBe('invalid');
  });
});

describe("the person's own", () => {
  it('positions: the balance and every position still open or waiting to be settled', async () => {
    const [first, second] = [await openedMarket(), await openedMarket()];
    const trader = await person('100');
    await placeTrade(app, trader, buy(first, { amount: '10' }));
    const no = await placeTrade(app, trader, buy(second, { outcome: 'no', amount: '20' }));
    const page = await positions(app, trader);
    await passes(outputOf(contract.portfolio.positions), page);
    expect(page.balance).toBe('70.000000');
    expect(page.positions.map((p) => p.marketId)).toEqual([second, first]);
    expect(page.positions[0]).toMatchObject({
      state: 'open',
      yes: '0.000000',
      no: no.shares,
      probability: no.probAfter,
      question: 'Will test event T happen before the end of the year?',
    });
    const after = await positions(app, trader, { after: second });
    expect(after.positions.map((p) => p.marketId)).toEqual([first]);
    // Someone else's are never among them.
    expect((await positions(app, await person('100'))).positions).toEqual([]);
  });

  it("orders: a page can't start after someone else's order", async () => {
    const market = await openedMarket();
    const [ann, raj] = [await person('100'), await person('100')];
    const order = await placeTrade(app, ann, buy(market, { limitProb: '0.2' }));
    await expect(refusal(openOrders(app, raj, { after: order.tradeId }))).resolves.toMatchObject({
      kind: 'invalid',
    });
  });
});

it('leaves the books without a problem', async () => {
  const { rows } = await owner.query('select problem from ledger.problems()');
  expect(rows).toEqual([]);
});
