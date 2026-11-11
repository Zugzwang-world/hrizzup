import { randomUUID } from 'node:crypto';
import type { CreateMarketInput, MarketQuoteInput, TradeInput } from '@hrizzup/api';
import { contract } from '@hrizzup/api';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeMarket, createMarket, openMarket } from './console.ts';
import { marketBook, marketHistory, marketQuote, marketTrades, oneMarket } from './data.ts';
import { cancelOrder, placeTrade, positions, TradingError } from './trading.ts';

/**
 * The public API's market data against a real database (PLAN.md step 3.5c; the Database check): each
 * read through `market_data`, on markets the console made, with nobody signed in; and, the step's
 * done-test in miniature, a quote for every one of hundreds of random trades (buys at the market, limit
 * buys that fill, part-fill or rest, sales; on deep and thin markets; with many people's resting
 * orders), each matching the trade that follows it to the millionth.
 */

const url = process.env.MARKETS_DATABASE_URL;
if (!url) throw new Error('MARKETS_DATABASE_URL is not set: run `pnpm test:db`');

let owner: pg.Pool;
let app: pg.Pool;
const ADMIN = randomUUID();

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: url, max: 4 });
  app = new pg.Pool({ connectionString: url, max: 8 });
  owner.on('error', () => {});
  app.on('error', () => {});
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    ADMIN,
    `${ADMIN}@data.test`,
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

/** A market an admin has made and opened. */
async function openedMarket(changes: Partial<CreateMarketInput> = {}): Promise<string> {
  const made = await createMarket(app, ADMIN, {
    id: newId(),
    question: 'Will test event D happen before the end of the year?',
    categories: ['general'],
    rules: 'Yes wins if the test desk records event D.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    probability: '0.5',
    seed: '1000',
    listed: false,
    ...changes,
  });
  await openMarket(app, ADMIN, made.id);
  return made.id;
}

/** Someone signed in, with this much play money. */
async function person(starting: string): Promise<string> {
  const userId = randomUUID();
  await owner.query('insert into auth.users (id, email) values ($1, $2)', [
    userId,
    `${userId}@data.test`,
  ]);
  await owner.query('select ledger.open_account($1, $2)', [userId, starting]);
  return userId;
}

/** The contract's own check of a call's answer. */
async function passes(procedure: { '~orpc': { outputSchema?: unknown } }, value: unknown) {
  const schema = procedure['~orpc'].outputSchema as {
    '~standard': { validate: (value: unknown) => unknown };
  };
  const result = (await schema['~standard'].validate(value)) as { issues?: unknown[] };
  expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
}

async function heldShares(userId: string, marketId: string) {
  const page = await positions(app, userId, { limit: 100 });
  const held = page.positions.find((position) => position.marketId === marketId);
  return { yes: held?.yes ?? '0', no: held?.no ?? '0' };
}

describe('the market reads', () => {
  it('answer for a market the console made, each passing the contract, naming nobody', async () => {
    const id = await openedMarket();
    const ann = await person('200');
    const raj = await person('200');
    const bought = await placeTrade(app, ann, {
      marketId: id,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'yes',
      amount: '25',
    });
    const resting = await placeTrade(app, raj, {
      marketId: id,
      requestId: randomUUID(),
      action: 'buy',
      outcome: 'no',
      amount: '10',
      limitProb: '0.8',
    });
    expect(resting.status).toBe('resting');

    const one = await oneMarket(app, id);
    await passes(contract.markets.get, one);
    expect(one.probability).toBe(bought.probAfter);

    const history = await marketHistory(app, id);
    await passes(contract.markets.history, history);
    expect(history.points.map((point) => point.probability)).toEqual([
      '0.50000000',
      bought.probAfter,
      bought.probAfter,
    ]);

    const book = await marketBook(app, id);
    await passes(contract.markets.book, book);
    expect(book).toEqual({
      marketId: id,
      probability: bought.probAfter,
      yes: [],
      no: [{ limitProb: '0.80000000', amount: '10.000000', orders: 1 }],
    });

    const trades = await marketTrades(app, id);
    await passes(contract.markets.trades, trades);
    expect(trades.trades).toEqual([
      {
        id: bought.tradeId,
        outcome: 'yes',
        action: 'buy',
        amount: bought.amount,
        shares: bought.shares,
        limitProb: null,
        probBefore: bought.probBefore,
        probAfter: bought.probAfter,
        at: bought.at,
      },
    ]);
    const answers = JSON.stringify([one, history, book, trades]);
    for (const personal of [ann, raj, ADMIN, bought.requestId, resting.requestId]) {
      expect(answers).not.toContain(personal);
    }

    // A cancelled order leaves the book.
    await cancelOrder(app, raj, {
      marketId: id,
      orderId: resting.tradeId,
      requestId: randomUUID(),
    });
    expect((await marketBook(app, id)).no).toEqual([]);
  });

  it('page through the latest trades, newest first, with the cursor each page gives', async () => {
    const id = await openedMarket();
    const zoe = await person('100');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const traded = await placeTrade(app, zoe, {
        marketId: id,
        requestId: randomUUID(),
        action: 'buy',
        outcome: i % 2 ? 'no' : 'yes',
        amount: '1',
      });
      ids.unshift(traded.tradeId);
    }
    const first = await marketTrades(app, id, { limit: 2 });
    const second = await marketTrades(app, id, { limit: 2, cursor: first.next ?? undefined });
    const third = await marketTrades(app, id, { limit: 2, cursor: second.next ?? undefined });
    expect([...first.trades, ...second.trades, ...third.trades].map((t) => t.id)).toEqual(ids);
    expect(third.next).toBeNull();
    await expect(marketTrades(app, id, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('answer "no such market" for a draft and for no market at all; a quote refuses a closed one', async () => {
    const made = await createMarket(app, ADMIN, {
      id: newId(),
      question: 'Will test event Q happen before the end of the year?',
      categories: ['general'],
      rules: 'A draft.',
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      probability: '0.5',
      seed: '1000',
      listed: false,
    });
    for (const id of [made.id, newId()]) {
      for (const read of [
        () => oneMarket(app, id),
        () => marketHistory(app, id, '1d'),
        () => marketBook(app, id),
        () => marketTrades(app, id),
        () => marketQuote(app, { id, outcome: 'yes', amount: '1' }),
      ]) {
        await expect(read()).rejects.toMatchObject({ kind: 'not_found' });
      }
    }
    const closed = await openedMarket();
    await closeMarket(app, ADMIN, closed);
    await expect(
      marketQuote(app, { id: closed, outcome: 'yes', amount: '1' }),
    ).rejects.toMatchObject({ kind: 'refused', reason: 'market_not_open' });
    await expect(oneMarket(app, closed)).resolves.toMatchObject({ market: { state: 'closed' } });
  });
});

// A small seeded random generator (mulberry32), so every run makes the same choices.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('a quote', () => {
  it('matches the trade that follows it, to the millionth, over 300 random trades', async () => {
    const rng = random(42);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
    const people = await Promise.all(Array.from({ length: 5 }, () => person('500')));
    const markets = [
      await openedMarket({ seed: '1000', probability: '0.5' }),
      await openedMarket({ seed: '100', probability: '0.3' }),
      await openedMarket({ seed: '20', probability: '0.8' }),
    ];
    let compared = 0;
    let rested = 0;
    for (let step = 0; step < 300; step++) {
      const who = pick(people);
      const marketId = pick(markets);
      const outcome = pick(['yes', 'no'] as const);
      const held = await heldShares(who, marketId);
      const shares = Number(outcome === 'yes' ? held.yes : held.no);
      let input: MarketQuoteInput;
      let trade: TradeInput;
      const requestId = randomUUID();
      if (shares > 0 && rng() < 0.3) {
        const selling = rng() < 0.5 ? shares : Math.floor(shares * rng() * 1e6) / 1e6;
        if (selling <= 0) continue;
        const text = selling.toFixed(6);
        input = { id: marketId, action: 'sell', outcome, shares: text };
        trade = { marketId, requestId, action: 'sell', outcome, shares: text };
      } else {
        const amount = (1 + rng() * 40).toFixed(6);
        const limit = rng() < 0.4 ? (0.05 + rng() * 0.9).toFixed(2) : undefined;
        input = {
          id: marketId,
          action: 'buy',
          outcome,
          amount,
          ...(limit === undefined ? {} : { limitProb: limit }),
        };
        trade = {
          marketId,
          requestId,
          action: 'buy',
          outcome,
          amount,
          ...(limit === undefined ? {} : { limitProb: limit }),
        };
      }
      let quoted: Awaited<ReturnType<typeof marketQuote>> | TradingError;
      try {
        quoted = await marketQuote(app, input);
      } catch (error) {
        if (!(error instanceof TradingError)) throw error;
        quoted = error;
      }
      let traded: Awaited<ReturnType<typeof placeTrade>> | TradingError;
      try {
        traded = await placeTrade(app, who, trade);
      } catch (error) {
        if (!(error instanceof TradingError)) throw error;
        traded = error;
      }
      if (quoted instanceof TradingError || traded instanceof TradingError) {
        // A refusal the quote gives, the trade gives too (a person's own balance aside, which a
        // public quote doesn't know).
        if (traded instanceof TradingError && traded.reason === 'insufficient_balance') continue;
        expect(
          { kind: (quoted as TradingError).kind, reason: (quoted as TradingError).reason },
          `step ${step}: ${JSON.stringify(input)}`,
        ).toEqual({ kind: (traded as TradingError).kind, reason: (traded as TradingError).reason });
        continue;
      }
      expect(
        {
          status: quoted.status,
          amount: quoted.amount,
          shares: quoted.shares,
          orderAmount: quoted.orderAmount,
          limitProb: quoted.limitProb,
          probBefore: quoted.probBefore,
          probAfter: quoted.probAfter,
        },
        `step ${step}: ${JSON.stringify(input)}`,
      ).toEqual({
        status: traded.status,
        amount: traded.amount,
        shares: traded.shares,
        orderAmount: traded.orderAmount,
        limitProb: traded.limitProb,
        probBefore: traded.probBefore,
        probAfter: traded.probAfter,
      });
      if (quoted.status === 'resting') rested += 1;
      compared += 1;
    }
    expect(compared).toBeGreaterThan(200);
    expect(rested).toBeGreaterThan(0);
    const { rows } = await owner.query<{ problem: string }>(
      'select problem from ledger.problems()',
    );
    expect(rows.map((row) => row.problem)).toEqual([]);
  });
});
