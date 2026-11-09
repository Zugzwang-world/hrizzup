import { randomUUID } from 'node:crypto';
import { transaction } from '@hrizzup/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { micros } from './decimal.ts';
import {
  balance,
  buy,
  connect,
  expectBooksBalance,
  market,
  type Person,
  person,
  position,
  sell,
  settle,
  traded,
} from './testing.ts';
import { trade } from './trade.ts';

/**
 * Trades at the same moment (the Database check): many connections trading at once, on one
 * market and across markets; retried requests; and a trade that fails part-way leaving nothing.
 */

let owner: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  owner = connect(4);
  app = connect(12); // Twelve trades in flight at once
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe('many trades on one market at once', () => {
  it('run strictly one after another: each starts at the price the one before it left', async () => {
    const id = await market(owner, { seed: '5000' });
    const traders = await Promise.all(Array.from({ length: 30 }, () => person(owner, '1000')));
    const results = await Promise.all(
      traders.flatMap((who, i) => [
        buy(app, who, id, i % 2 ? 'YES' : 'NO', `${10 + i}.5`),
        buy(app, who, id, i % 3 ? 'NO' : 'YES', '7.25', { limitProb: i % 2 ? '0.45' : '0.55' }),
        buy(app, who, id, i % 2 ? 'NO' : 'YES', '3'),
      ]),
    );
    expect(results.every((result) => result.status !== 'refused')).toBe(true);
    // Every trade got the next number, with no gap and no two the same.
    const { rows } = await owner.query<{
      number: number;
      prob_before: string;
      prob_after: string;
    }>(
      `select number, prob_before::text, prob_after::text from markets.trades
       where market_id = $1 and kind <> 'redeem' order by number`,
      [id],
    );
    expect(rows.map((row) => row.number)).toEqual(rows.map((_, i) => i + 1));
    expect(rows).toHaveLength(90);
    for (const [i, row] of rows.entries()) {
      if (i > 0) expect(row.prob_before, `trade ${row.number}`).toBe(rows[i - 1]?.prob_after);
    }
    await expectBooksBalance(owner);
  });

  it('wait for the market while another trade holds it, then go ahead', async () => {
    const id = await market(owner);
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const holder = await app.connect();
    try {
      // Ann's trade starts and holds the market's lock, unfinished.
      await holder.query('begin');
      await holder.query(
        `select set_config('role', 'hrizzup_app', true),
                set_config('request.jwt.claim.sub', $1, true)`,
        [ann.userId],
      );
      await holder.query('select markets.begin_trade($1, $2, $3, $4)', [
        randomUUID(),
        id,
        'buy',
        { outcome: 'YES', amount: '1.000000' },
      ]);
      let finished = 0;
      const waiting = buy(app, raj, id, 'YES', '10').then((result) => {
        finished = Date.now();
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(finished).toBe(0); // Raj's trade is still waiting for the market
      const released = Date.now();
      await holder.query('rollback');
      expect(traded(await waiting).number).toBe(1);
      expect(finished).toBeGreaterThanOrEqual(released);
    } finally {
      holder.release();
    }
    await expectBooksBalance(owner);
  });
});

describe('many trades across markets at once', () => {
  it('never take anyone below zero: each spends only what they hold', async () => {
    const markets = await Promise.all(Array.from({ length: 10 }, () => market(owner)));
    const traders = await Promise.all(Array.from({ length: 8 }, () => person(owner, '100')));
    // Each trader tries Ṁ30 on all ten markets at once: only three can be paid for.
    const results = await Promise.all(
      traders.flatMap((who) => markets.map((id) => buy(app, who, id, 'YES', '30'))),
    );
    for (const who of traders) {
      const mine = results.filter((_, i) => traders[Math.floor(i / markets.length)] === who);
      expect(mine.filter((result) => result.status === 'filled')).toHaveLength(3);
      expect(
        mine.filter(
          (result) => result.status === 'refused' && result.reason === 'insufficient_balance',
        ),
      ).toHaveLength(7);
      expect(await balance(owner, who.accountId)).toBe(micros('10'));
    }
    await expectBooksBalance(owner);
  });

  it('keep the books with buys, sales and orders on every market at once', async () => {
    const markets = await Promise.all(Array.from({ length: 5 }, () => market(owner)));
    const traders = await Promise.all(Array.from({ length: 10 }, () => person(owner, '500')));
    await Promise.all(
      traders.flatMap((who, i) =>
        markets.map((id, j) =>
          buy(
            app,
            who,
            id,
            (i + j) % 2 ? 'YES' : 'NO',
            '20',
            (i + j) % 3 ? {} : { limitProb: '0.5' },
          ),
        ),
      ),
    );
    await Promise.all(
      traders.flatMap((who) =>
        markets.map(async (id) => {
          const held = await position(owner, id, who.accountId);
          if (held.yes > 0n) return sell(app, who, id, 'YES', held.yes / 2n);
          if (held.no > 0n) return sell(app, who, id, 'NO', held.no / 2n);
          return undefined;
        }),
      ),
    );
    await expectBooksBalance(owner);
  });
});

describe('a settlement at the same moment as trades', () => {
  it('runs between them: each trade lands before it, or is refused after it', async () => {
    const id = await market(owner);
    const traders = await Promise.all(Array.from({ length: 10 }, () => person(owner, '200')));
    const trades = traders.flatMap((who, i) => [
      buy(app, who, id, i % 2 ? 'YES' : 'NO', '15'),
      buy(app, who, id, i % 2 ? 'NO' : 'YES', '5', { limitProb: '0.5' }),
      buy(app, who, id, i % 3 ? 'YES' : 'NO', '7'),
    ]);
    const settling = new Promise((resolve) => setTimeout(resolve, 15)).then(() =>
      settle(owner, id, 'YES'),
    );
    const results = await Promise.all(trades);
    await settling;
    for (const result of results) {
      const before = ['filled', 'partly_filled', 'resting'].includes(result.status);
      const after = result.status === 'refused' && result.reason === 'market_not_open';
      expect(before || after, JSON.stringify(result)).toBe(true);
    }
    const { rows } = await owner.query<{ state: string; open_orders: number }>(
      `select m.state,
              (select count(*)::int from markets.trades t
               where t.market_id = m.id and t.limit_prob is not null
                 and not t.is_filled and not t.is_cancelled) as open_orders
       from markets.markets m where m.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ state: 'settled', open_orders: 0 });
    await expectBooksBalance(owner);
  });

  it("neither waits forever nor deadlocks with its traders' trades on other markets", async () => {
    const settling = await market(owner);
    const other = await market(owner);
    const traders = await Promise.all(Array.from({ length: 8 }, () => person(owner, '300')));
    await Promise.all(traders.map((who) => buy(app, who, settling, 'YES', '20')));
    const [settled, ...elsewhere] = await Promise.all([
      settle(owner, settling, 'NO'),
      ...traders.flatMap((who) => [
        buy(app, who, other, 'YES', '10'),
        buy(app, who, other, 'NO', '10'),
      ]),
    ]);
    expect(settled).toMatchObject({ resolution: 'NO', people: 0 }); // Everyone held Yes
    expect(elsewhere.every((result) => (result as { status: string }).status === 'filled')).toBe(
      true,
    );
    await expectBooksBalance(owner);
  });
});

describe('a retried request', () => {
  const sameBuy = (who: Person, id: string, requestId: string, amount = '25') =>
    trade(app, who.userId, { action: 'buy', requestId, marketId: id, outcome: 'YES', amount });

  async function tradesFor(requestId: string): Promise<number> {
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from markets.trades where request_id = $1',
      [requestId],
    );
    return (rows[0] as { n: number }).n;
  }

  it('returns the first result and never trades twice', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    const first = await sameBuy(ann, id, requestId);
    const again = await sameBuy(ann, id, requestId);
    expect(again).toEqual(first);
    expect(await tradesFor(requestId)).toBe(1);
    expect(await balance(owner, ann.accountId)).toBe(micros('75'));
    await expectBooksBalance(owner);
  });

  it('sent many times at once still trades once, and every answer is the same', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    const answers = await Promise.all(Array.from({ length: 8 }, () => sameBuy(ann, id, requestId)));
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(await tradesFor(requestId)).toBe(1);
    expect(await balance(owner, ann.accountId)).toBe(micros('75'));
    await expectBooksBalance(owner);
  });

  it('returns a refusal again, even once the money is there', async () => {
    const ann = await person(owner, '10');
    const id = await market(owner);
    const requestId = randomUUID();
    const first = await sameBuy(ann, id, requestId);
    expect(first).toMatchObject({ status: 'refused', reason: 'insufficient_balance' });
    await owner.query(`select ledger.grant_money($1, 100, 'testing a retry')`, [ann.accountId]);
    expect(await sameBuy(ann, id, requestId)).toEqual(first);
    expect(await tradesFor(requestId)).toBe(0);
  });

  it('with the same ID but a different request is refused', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    await sameBuy(ann, id, requestId, '25');
    await expect(sameBuy(ann, id, requestId, '26')).rejects.toMatchObject({ code: '23505' });
    expect(await tradesFor(requestId)).toBe(1);
  });

  it("is each person's own: the same ID from two people is two requests", async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    const hers = traded(await sameBuy(ann, id, requestId));
    const his = traded(await sameBuy(raj, id, requestId));
    expect(his.trade_id).not.toBe(hers.trade_id);
    expect(await tradesFor(requestId)).toBe(2);
    await expectBooksBalance(owner);
  });
});

describe('a trade that fails part-way', () => {
  it('leaves nothing behind: no trade, no fill, no move, no stored result', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    const tradeId = randomUUID();
    await expect(
      transaction(
        app,
        async (tx) => {
          await tx.query('select markets.begin_trade($1, $2, $3, $4)', [
            requestId,
            id,
            'buy',
            { outcome: 'YES', amount: '10.000000' },
          ]);
          // Ṁ10 in, but shares and a pool that don't add up: the database refuses it all.
          return tx.query('select markets.apply_trade($1)', [
            {
              request_id: requestId,
              market_id: id,
              action: 'buy',
              params: { outcome: 'YES', amount: '10.000000' },
              trade: { id: tradeId, outcome: 'YES', order_amount: '10.000000', is_filled: true },
              fills: [{ matched: null, amount: '10.000000', shares: '500.000000' }],
              makers: [],
              cancel: [],
              pool: { yes: '1000.000000', no: '1010.000000' },
            },
          ]);
        },
        { account: ann.userId },
      ),
    ).rejects.toThrow(/does not add up/);
    const { rows } = await owner.query<{ trades: number; fills: number; requests: number }>(
      `select (select count(*)::int from markets.trades where id = $1) as trades,
              (select count(*)::int from markets.fills where trade_id = $1) as fills,
              (select count(*)::int from markets.requests where id = $2) as requests`,
      [tradeId, requestId],
    );
    expect(rows[0]).toEqual({ trades: 0, fills: 0, requests: 0 });
    expect(await balance(owner, ann.accountId)).toBe(micros('100'));
    // The same request then trades normally, once.
    const result = await trade(app, ann.userId, {
      action: 'buy',
      requestId,
      marketId: id,
      outcome: 'YES',
      amount: '10',
    });
    expect(traded(result).amount).toBe('10.000000');
    await expectBooksBalance(owner);
  });
});
