import { randomUUID } from 'node:crypto';
import { transaction } from '@hrizzup/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decimal, micros, min } from './decimal.ts';
import { type MarketState, paramsOf, planTrade } from './plan.ts';
import {
  balance,
  buy,
  connect,
  expectBooksBalance,
  market,
  person,
  position,
  sell,
  settle,
  traded,
  waitUntil,
} from './testing.ts';
import { trade } from './trade.ts';

/**
 * The books' rules, one by one, against a real database built from the migrations (the
 * Database check). Every trade runs through trade(), as the app's own role; the books are
 * checked after every step (ledger.problems() must be empty).
 */

let owner: pg.Pool;
let app: pg.Pool;

beforeAll(() => {
  owner = connect(4);
  app = connect(4);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end()]);
});

describe('a market', () => {
  it('opens with the house seeding its pool, and the books sum to zero', async () => {
    const id = await market(owner, { seed: '1000', probability: '0.37' });
    const { rows } = await owner.query(
      `select m.state, m.p::text, m.pool_yes::text, m.pool_no::text, a.balance::text as held
       from markets.markets m join ledger.accounts a on a.id = m.account_id where m.id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      state: 'open',
      p: '0.37000000',
      pool_yes: '1000.000000',
      pool_no: '1000.000000',
      held: '1000.000000',
    });
    await expectBooksBalance(owner);
  });
});

describe('a buy', () => {
  it('moves exactly what was asked into the pool, for the shares the maths gives', async () => {
    const ann = await person(owner, '500');
    const id = await market(owner);
    const result = traded(await buy(app, ann, id, 'YES', '100'));
    expect(result).toMatchObject({
      status: 'filled',
      amount: '100.000000',
      shares: '190.909090', // 1100 − 1000²/1100 = 190.9090909…, rounded down: the house's way
      balance: '400.000000',
      prob_before: '0.50000000',
      position: { yes: '190.909090', no: '0.000000' },
    });
    // The pool keeps the millionth the rounding left: 1,100 Ṁ held, less 190.909090 Yes shares.
    const { rows } = await owner.query(
      'select pool_yes::text, pool_no::text from markets.markets where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ pool_yes: '909.090910', pool_no: '1100.000000' });
    expect(await balance(owner, ann.accountId)).toBe(micros('400'));
    await expectBooksBalance(owner);
  });

  it('is refused past the balance, and nothing moves', async () => {
    const ann = await person(owner, '50');
    const id = await market(owner);
    const result = await buy(app, ann, id, 'YES', '50.000001');
    expect(result).toMatchObject({ status: 'refused', reason: 'insufficient_balance' });
    expect(await balance(owner, ann.accountId)).toBe(micros('50'));
    expect(traded(await buy(app, ann, id, 'YES', '50')).balance).toBe('0.000000');
    await expectBooksBalance(owner);
  });

  it('is refused once the market has closed, checked inside the trade itself', async () => {
    const ann = await person(owner, '100');
    const closesAt = new Date(Date.now() + 1_500);
    const id = await market(owner, { closesAt });
    expect((await buy(app, ann, id, 'YES', '10')).status).toBe('filled');
    await waitUntil(closesAt); // No job closes it: the next trade finds the time has passed
    const after = await buy(app, ann, id, 'YES', '10');
    expect(after).toMatchObject({ status: 'refused', reason: 'market_closed' });
    expect(await balance(owner, ann.accountId)).toBe(micros('90'));
    await expectBooksBalance(owner);
  });
});

describe('a limit order', () => {
  it('rests, then fills when a later trade reaches its price, its owner paying their part', async () => {
    const ann = await person(owner, '1000');
    const raj = await person(owner, '500');
    const id = await market(owner);
    // Raj buys No once Yes reaches 60%.
    const order = traded(await buy(app, raj, id, 'NO', '40', { limitProb: '0.6' }));
    expect(order).toMatchObject({ status: 'resting', amount: '0.000000', balance: '500.000000' });
    traded(await buy(app, ann, id, 'YES', '400'));
    const { rows } = await owner.query(
      `select amount::text, shares::text, is_filled from markets.trades where id = $1`,
      [order.trade_id],
    );
    expect(rows[0]).toEqual({ amount: '40.000000', shares: '100.000000', is_filled: true });
    expect(await balance(owner, raj.accountId)).toBe(micros('460'));
    expect(await position(owner, id, raj.accountId)).toEqual({ yes: 0n, no: micros('100') });
    await expectBooksBalance(owner);
  });

  it('never fills after it expires, and is marked expired by the next trade', async () => {
    const ann = await person(owner, '1000');
    const raj = await person(owner, '500');
    const id = await market(owner);
    const expiresAt = new Date(Date.now() + 1_000);
    const order = traded(await buy(app, raj, id, 'NO', '100', { limitProb: '0.6', expiresAt }));
    expect(order.status).toBe('resting');
    await waitUntil(expiresAt); // No job expires it: the next trade checks
    traded(await buy(app, ann, id, 'YES', '400'));
    expect(await balance(owner, raj.accountId)).toBe(micros('500'));
    const { rows } = await owner.query(
      'select is_cancelled, cancel_reason from markets.trades where id = $1',
      [order.trade_id],
    );
    expect(rows[0]).toEqual({ is_cancelled: true, cancel_reason: 'expired' });
    await expectBooksBalance(owner);
  });

  it('stops filling when its owner runs out of money, and the rest is cancelled', async () => {
    const ann = await person(owner, '1000');
    const raj = await person(owner, '130');
    const id = await market(owner);
    const order = traded(await buy(app, raj, id, 'NO', '100', { limitProb: '0.6' }));
    traded(await buy(app, raj, id, 'NO', '100')); // Raj spends most of the money behind it
    traded(await buy(app, ann, id, 'YES', '400'));
    const { rows } = await owner.query(
      'select amount::text, is_cancelled, cancel_reason from markets.trades where id = $1',
      [order.trade_id],
    );
    expect(rows[0]).toEqual({
      amount: '30.000000',
      is_cancelled: true,
      cancel_reason: 'no_balance',
    });
    expect(await balance(owner, raj.accountId)).toBe(0n);
    await expectBooksBalance(owner);
  });

  it('is withdrawn by its owner, and only by its owner', async () => {
    const raj = await person(owner, '500');
    const ann = await person(owner, '500');
    const id = await market(owner);
    // No at 70%: it waits for Yes to rise that far.
    const order = traded(await buy(app, raj, id, 'NO', '50', { limitProb: '0.7' }));
    expect(order.status).toBe('resting');
    const theirs = await trade(app, ann.userId, {
      action: 'cancel_order',
      requestId: randomUUID(),
      marketId: id,
      orderId: order.trade_id,
    });
    expect(theirs).toMatchObject({ status: 'refused', reason: 'no_open_order' });
    const mine = await trade(app, raj.userId, {
      action: 'cancel_order',
      requestId: randomUUID(),
      marketId: id,
      orderId: order.trade_id,
    });
    expect(mine).toMatchObject({ status: 'cancelled', order_id: order.trade_id });
    expect(await balance(owner, raj.accountId)).toBe(micros('500'));
    await expectBooksBalance(owner);
  });

  it("meets its owner's own trade as a wash: the two sides cancel out at once", async () => {
    const raj = await person(owner, '1000');
    const id = await market(owner);
    const order = traded(await buy(app, raj, id, 'NO', '40', { limitProb: '0.6' }));
    traded(await buy(app, raj, id, 'YES', '400'));
    const { rows } = await owner.query(
      'select amount::text, shares::text, is_filled from markets.trades where id = $1',
      [order.trade_id],
    );
    // Raj's own order sold him 100 Yes at Ṁ0.60 while he paid Ṁ0.40 for 100 No: the pairs
    // are redeemed at once, so of his Ṁ440 out, Ṁ100 comes straight back.
    expect(rows[0]).toEqual({ amount: '40.000000', shares: '100.000000', is_filled: true });
    expect(await balance(owner, raj.accountId)).toBe(micros('660'));
    expect((await position(owner, id, raj.accountId)).no).toBe(0n);
    await expectBooksBalance(owner);
  });
});

describe('resting orders at the same price', () => {
  it('fill in the order they were placed, even within one millisecond', async () => {
    const ann = await person(owner, '1000');
    const raj = await person(owner, '500');
    const mei = await person(owner, '500');
    const id = await market(owner);
    // Both buy No once Yes reaches 60%, placed one straight after the other.
    const first = traded(await buy(app, raj, id, 'NO', '30', { limitProb: '0.6' }));
    const second = traded(await buy(app, mei, id, 'NO', '30', { limitProb: '0.6' }));
    // Ṁ224.74 takes the pool to 60%; the rest fills Raj's order whole, then part of Mei's.
    traded(await buy(app, ann, id, 'YES', '300'));
    const { rows } = await owner.query<{ id: string; amount: string; is_filled: boolean }>(
      'select id, amount::text, is_filled from markets.trades where id = any ($1)',
      [[first.trade_id, second.trade_id]],
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[first.trade_id]).toMatchObject({ amount: '30.000000', is_filled: true });
    expect(byId[second.trade_id]?.is_filled).toBe(false);
    expect(Number(byId[second.trade_id]?.amount)).toBeGreaterThan(20);
    expect(Number(byId[second.trade_id]?.amount)).toBeLessThan(21);
    await expectBooksBalance(owner);
  });
});

describe('a sale', () => {
  it('sells exactly the shares asked for; selling everything straight back returns the stake', async () => {
    const ann = await person(owner, '500');
    const id = await market(owner);
    const bought = traded(await buy(app, ann, id, 'YES', '200'));
    const sold = traded(await sell(app, ann, id, 'YES', bought.shares));
    expect(sold.shares).toBe(`-${bought.shares}`);
    expect(micros(sold.amount)).toBeLessThan(0n);
    // No fees and nobody else traded: within a few millionths of the stake.
    const back = await balance(owner, ann.accountId);
    expect(back > micros('499.99999') && back <= micros('500')).toBe(true);
    await expectBooksBalance(owner);
  });

  it('is refused past the shares held', async () => {
    const ann = await person(owner, '500');
    const id = await market(owner);
    const bought = traded(await buy(app, ann, id, 'YES', '100'));
    const result = await sell(app, ann, id, 'YES', micros(bought.shares) + 1n);
    expect(result).toMatchObject({ status: 'refused', reason: 'not_enough_shares' });
    await expectBooksBalance(owner);
  });
});

describe('Yes and No held together', () => {
  it('cancel out, paying Ṁ1 a pair, so only one side is ever held', async () => {
    const ann = await person(owner, '500');
    const id = await market(owner);
    const yes = traded(await buy(app, ann, id, 'YES', '100'));
    const before = await balance(owner, ann.accountId);
    const no = traded(await buy(app, ann, id, 'NO', '100'));
    const held = await position(owner, id, ann.accountId);
    const pairs = min(micros(yes.shares), micros(no.shares));
    expect(held.yes === 0n || held.no === 0n).toBe(true);
    expect(await balance(owner, ann.accountId)).toBe(before - micros('100') + pairs);
    const { rows } = await owner.query(
      `select count(*)::int as n from markets.trades
       where market_id = $1 and account_id = $2 and kind = 'redeem'`,
      [id, ann.accountId],
    );
    expect(rows[0]).toEqual({ n: 1 });
    await expectBooksBalance(owner);
  });
});

describe('settlement', () => {
  async function tradedMarket() {
    const ann = await person(owner, '500');
    const raj = await person(owner, '500');
    const id = await market(owner);
    const yes = traded(await buy(app, ann, id, 'YES', '200'));
    const no = traded(await buy(app, raj, id, 'NO', '300'));
    return { ann, raj, id, yes, no };
  }

  it('YES pays Ṁ1 for each Yes share, the house the rest, and the market ends at zero', async () => {
    const { ann, raj, id, yes } = await tradedMarket();
    const result = await settle(owner, id, 'YES');
    expect(await balance(owner, ann.accountId)).toBe(micros('300') + micros(yes.shares));
    expect(await balance(owner, raj.accountId)).toBe(micros('200'));
    expect(result).toMatchObject({ resolution: 'YES', people: 1 });
    await expectBooksBalance(owner);
  });

  it('NO pays Ṁ1 for each No share', async () => {
    const { ann, raj, id, no } = await tradedMarket();
    await settle(owner, id, 'NO');
    expect(await balance(owner, ann.accountId)).toBe(micros('300'));
    expect(await balance(owner, raj.accountId)).toBe(micros('200') + micros(no.shares));
    await expectBooksBalance(owner);
  });

  it('at a set probability pays each share its part of Ṁ1, rounded once', async () => {
    const { ann, raj, id, yes, no } = await tradedMarket();
    await settle(owner, id, 'MKT', '0.25');
    // Each payout rounded once, down to a millionth: the house's way.
    const part = (shares: string, percent: bigint) => (micros(shares) * percent) / 100n;
    expect(await balance(owner, ann.accountId)).toBe(micros('300') + part(yes.shares, 25n));
    expect(await balance(owner, raj.accountId)).toBe(micros('200') + part(no.shares, 75n));
    await expectBooksBalance(owner);
  });

  it('cancelled, gives everyone back exactly what they put in', async () => {
    const { ann, raj, id } = await tradedMarket();
    const result = await settle(owner, id, 'CANCEL');
    expect(await balance(owner, ann.accountId)).toBe(micros('500'));
    expect(await balance(owner, raj.accountId)).toBe(micros('500'));
    expect(result).toMatchObject({ resolution: 'CANCEL', to_house: '1000.000000' });
    await expectBooksBalance(owner);
  });

  it('cancelled, takes back sale profits, and the balance shows what is owed', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '1000');
    const id = await market(owner);
    const elsewhere = await market(owner);
    const yes = traded(await buy(app, ann, id, 'YES', '100'));
    traded(await buy(app, raj, id, 'YES', '800')); // The price rises
    traded(await sell(app, ann, id, 'YES', yes.shares)); // Ann sells at a profit
    const profit = (await balance(owner, ann.accountId)) - micros('100');
    expect(profit > 0n).toBe(true);
    traded(await buy(app, ann, elsewhere, 'YES', await balance(owner, ann.accountId))); // Spent
    await settle(owner, id, 'CANCEL');
    expect(await balance(owner, ann.accountId)).toBe(-profit);
    // What's owed is shown, and no trade can take it lower.
    expect(await buy(app, ann, elsewhere, 'NO', '1')).toMatchObject({
      status: 'refused',
      reason: 'insufficient_balance',
    });
    await expectBooksBalance(owner);
  });

  it('happens once: a settled market refuses another settlement and every trade', async () => {
    const { ann, id } = await tradedMarket();
    await settle(owner, id, 'NO');
    await expect(settle(owner, id, 'YES')).rejects.toThrow(/already settled/);
    expect(await buy(app, ann, id, 'YES', '1')).toMatchObject({
      status: 'refused',
      reason: 'market_not_open',
    });
    await expectBooksBalance(owner);
  });

  it('of a market nobody traded gives the house its seed back', async () => {
    for (const resolution of ['YES', 'NO', 'CANCEL'] as const) {
      const id = await market(owner, { seed: '1000' });
      expect(await settle(owner, id, resolution)).toMatchObject({ to_house: '1000.000000' });
    }
    await expectBooksBalance(owner);
  });
});

describe('a trade the maths did not make', () => {
  /** Starts a trade as `who`, then applies `plan` in the same transaction. */
  async function applyCrafted(who: { userId: string }, marketId: string, plan: object) {
    const p = plan as { request_id: string; action: string; params: object };
    return transaction(
      app,
      async (tx) => {
        await tx.query('select markets.begin_trade($1, $2, $3, $4)', [
          p.request_id,
          marketId,
          p.action,
          p.params,
        ]);
        return tx.query('select markets.apply_trade($1)', [{ market_id: marketId, ...plan }]);
      },
      { account: who.userId },
    );
  }

  const crafted = (action: 'buy' | 'sell', params: object, rest: object) => ({
    request_id: randomUUID(),
    action,
    params,
    makers: [],
    cancel: [],
    ...rest,
  });

  it('is refused when it pays out money the pool never gave', async () => {
    const ann = await person(owner, '10');
    const id = await market(owner);
    // A "sale" of nothing that pays Ṁ900 out of the market's Ṁ1,000, with a pool to match.
    const plan = crafted(
      'sell',
      { outcome: 'YES', shares: '1.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', is_filled: true },
        fills: [{ matched: null, amount: '-900.000000', shares: '0.000000' }],
        pool: { yes: '100.000000', no: '100.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/off its curve/);
    expect(await balance(owner, ann.accountId)).toBe(micros('10'));
    await expectBooksBalance(owner);
  });

  it('is refused when it gives more shares than the money buys', async () => {
    const ann = await person(owner, '10');
    const id = await market(owner);
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '10.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '10.000000', is_filled: true },
        fills: [{ matched: null, amount: '10.000000', shares: '500.000000' }],
        pool: { yes: '510.000000', no: '1010.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/off its curve/);
    await expectBooksBalance(owner);
  });

  it('is refused when it does not match its request', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '10.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '50.000000', is_filled: true },
        fills: [{ matched: null, amount: '50.000000', shares: '95.238095' }],
        pool: { yes: '954.761905', no: '1050.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/does not match its request/);
    await expectBooksBalance(owner);
  });

  it('is refused when a resting order pays anything but its limit price', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner);
    // Raj buys No at 40% once Yes reaches 60%. Filling it at once, at Ṁ0.50 a share instead:
    const order = traded(await buy(app, raj, id, 'NO', '20', { limitProb: '0.6' }));
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '10.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '10.000000', is_filled: true },
        fills: [{ matched: order.trade_id, amount: '10.000000', shares: '20.000000' }],
        makers: [{ order_id: order.trade_id, amount: '10.000000', shares: '20.000000' }],
        pool: { yes: '1000.000000', no: '1000.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/limit price/);
    await expectBooksBalance(owner);
  });

  it('is refused when it fills an order the price never reached', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner);
    // Raj buys No at 10% once Yes reaches 90%; the price is 50%, and this plan never moves it.
    const order = traded(await buy(app, raj, id, 'NO', '2', { limitProb: '0.9' }));
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '18.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '18.000000', is_filled: true },
        fills: [{ matched: order.trade_id, amount: '18.000000', shares: '20.000000' }],
        makers: [{ order_id: order.trade_id, amount: '2.000000', shares: '20.000000' }],
        pool: { yes: '1000.000000', no: '1000.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/never reached/);
    await expectBooksBalance(owner);
  });

  it('is refused when its request is not the one the trade started with', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    await expect(
      transaction(
        app,
        async (tx) => {
          await tx.query('select markets.begin_trade($1, $2, $3, $4)', [
            requestId,
            id,
            'buy',
            { outcome: 'YES', amount: '1.000000' },
          ]);
          return tx.query('select markets.apply_trade($1)', [
            {
              request_id: requestId,
              market_id: id,
              action: 'buy',
              params: { outcome: 'YES', amount: '10.000000' },
              refusal: 'insufficient_balance',
            },
          ]);
        },
        { account: ann.userId },
      ),
    ).rejects.toThrow(/not the one begin_trade started/);
  });

  it('is refused when its action is not the one the trade started with', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const requestId = randomUUID();
    const params = { outcome: 'YES', amount: '1.000000' };
    await expect(
      transaction(
        app,
        async (tx) => {
          await tx.query('select markets.begin_trade($1, $2, $3, $4)', [
            requestId,
            id,
            'buy',
            params,
          ]);
          return tx.query('select markets.apply_trade($1)', [
            {
              request_id: requestId,
              market_id: id,
              action: 'sell',
              params,
              refusal: 'price_limit',
            },
          ]);
        },
        { account: ann.userId },
      ),
    ).rejects.toThrow(/not the one begin_trade started/);
  });

  it('is refused when it passes an order it should have filled', async () => {
    const ann = await person(owner, '1000');
    const raj = await person(owner, '100');
    const id = await market(owner);
    const order = traded(await buy(app, raj, id, 'NO', '20', { limitProb: '0.55' }));
    const request = {
      action: 'buy' as const,
      requestId: randomUUID(),
      marketId: id,
      outcome: 'YES' as const,
      amount: '400',
    };
    // A real plan from the maths, but worked out as if Raj's order weren't there: the price
    // goes past his 55% from the pool alone, and he can pay.
    await expect(
      transaction(
        app,
        async (tx) => {
          const { rows } = await tx.query<{ state: MarketState }>(
            'select markets.begin_trade($1, $2, $3, $4) as state',
            [request.requestId, id, 'buy', paramsOf(request)],
          );
          const state = rows[0]?.state as MarketState;
          const plan = planTrade(request, { ...state, orders: [], balances: {} }, randomUUID());
          return tx.query('select markets.apply_trade($1)', [plan]);
        },
        { account: ann.userId },
      ),
    ).rejects.toThrow(/without filling it, though its owner can pay/);
    const { rows } = await owner.query('select is_cancelled from markets.trades where id = $1', [
      order.trade_id,
    ]);
    expect(rows[0]).toEqual({ is_cancelled: false });
    await expectBooksBalance(owner);
  });

  it("can't cancel the order of someone who can still pay for it", async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner);
    const order = traded(await buy(app, raj, id, 'NO', '20', { limitProb: '0.6' }));
    const request = {
      action: 'buy' as const,
      requestId: randomUUID(),
      marketId: id,
      outcome: 'YES' as const,
      amount: '5',
    };
    // A real trade from the maths, with Raj's order slipped into its list to cancel.
    await transaction(
      app,
      async (tx) => {
        const { rows } = await tx.query<{ state: MarketState }>(
          'select markets.begin_trade($1, $2, $3, $4) as state',
          [request.requestId, id, 'buy', paramsOf(request)],
        );
        const plan = planTrade(request, rows[0]?.state as MarketState, randomUUID());
        return tx.query('select markets.apply_trade($1)', [{ ...plan, cancel: [order.trade_id] }]);
      },
      { account: ann.userId },
    );
    const { rows } = await owner.query('select is_cancelled from markets.trades where id = $1', [
      order.trade_id,
    ]);
    expect(rows[0]).toEqual({ is_cancelled: false });
    await expectBooksBalance(owner);
  });

  it('is refused when its fills name an order it does not fill', async () => {
    const ann = await person(owner, '100');
    const id = await market(owner);
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '10.000000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '10.000000', is_filled: true },
        fills: [{ matched: randomUUID(), amount: '10.000000', shares: '19.090909' }],
        pool: { yes: '990.909091', no: '1010.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/do not agree/);
    await expectBooksBalance(owner);
  });

  it('is refused when it names one order twice, to widen what rounding is allowed', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner);
    const order = traded(await buy(app, raj, id, 'NO', '20', { limitProb: '0.5' }));
    const twice = [0, 1].map(() => ({
      order_id: order.trade_id,
      amount: '0.400000',
      shares: '0.800000',
    }));
    const plan = crafted(
      'buy',
      { outcome: 'YES', amount: '0.800000' },
      {
        trade: { id: randomUUID(), outcome: 'YES', order_amount: '0.800000', is_filled: true },
        fills: twice.map(() => ({
          matched: order.trade_id,
          amount: '0.400000',
          shares: '0.800000',
        })),
        makers: twice,
        pool: { yes: '1000.000000', no: '1000.000000' },
      },
    );
    await expect(applyCrafted(ann, id, plan)).rejects.toThrow(/more than once/);
    await expectBooksBalance(owner);
  });
});

describe('fair trades at the edges of what the database allows', () => {
  it('pass in a market seeded with Ṁ1, ending exactly at a resting order', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner, { seed: '1' });
    traded(await buy(app, raj, id, 'NO', '0.1', { limitProb: '0.6' }));
    // Enough to take this thin pool to 60%: part of the pool, then part of Raj's order.
    const result = traded(await buy(app, ann, id, 'YES', '0.3'));
    expect(result.status).toBe('filled');
    traded(await sell(app, ann, id, 'YES', result.shares));
    await expectBooksBalance(owner);
  });

  it('pass with one pool side under Ṁ0.2', async () => {
    const ann = await person(owner, '100');
    const raj = await person(owner, '100');
    const id = await market(owner, { seed: '1' });
    const pushed = traded(await buy(app, ann, id, 'YES', '20')); // To the 99% limit
    const { rows } = await owner.query<{ pool_yes: string }>(
      'select pool_yes::text from markets.markets where id = $1',
      [id],
    );
    expect(Number(rows[0]?.pool_yes)).toBeLessThan(0.2);
    traded(await buy(app, raj, id, 'NO', '0.05'));
    traded(await sell(app, ann, id, 'YES', decimal(micros(pushed.shares) / 3n)));
    traded(await buy(app, raj, id, 'YES', '0.01', { limitProb: '0.95' }));
    await expectBooksBalance(owner);
  });

  it('pass when one trade sweeps forty resting orders', async () => {
    const ann = await person(owner, '3000');
    const id = await market(owner);
    const makers = await Promise.all(Array.from({ length: 40 }, () => person(owner, '10')));
    for (const [i, who] of makers.entries()) {
      traded(await buy(app, who, id, 'NO', '1', { limitProb: (0.51 + i * 0.01).toFixed(2) }));
    }
    // About Ṁ2,000 takes this pool from 50% to 90%; the forty orders fill on the way.
    const result = traded(await buy(app, ann, id, 'YES', '2500'));
    const { rows } = await owner.query<{ open: number }>(
      `select count(*)::int as open from markets.trades
       where market_id = $1 and limit_prob is not null and not is_filled and not is_cancelled`,
      [id],
    );
    expect(rows[0]).toEqual({ open: 0 });
    expect(Number(result.prob_after)).toBeGreaterThan(0.9);
    await expectBooksBalance(owner);
  });
});

describe('the books', () => {
  it('are never edited or deleted, not even by their owner', async () => {
    for (const statement of [
      'update ledger.moves set amount = amount + 1',
      'delete from ledger.moves',
      'truncate ledger.moves cascade',
      'update ledger.entries set memo = $$changed$$',
      'delete from ledger.entries',
      'delete from ledger.accounts',
      'update ledger.accounts set balance = balance + 1',
      'update markets.requests set result = $${}$$',
      'delete from markets.fills',
    ]) {
      await expect(owner.query(statement), statement).rejects.toThrow();
    }
    await expectBooksBalance(owner);
  });

  it('refuse a move that would take a person below zero, whoever writes it', async () => {
    const ann = await person(owner, '10');
    await expect(
      owner.query(`select ledger.correct($1, ledger.house(), 10.000001, 'testing the floor')`, [
        ann.accountId,
      ]),
    ).rejects.toThrow(/below zero/);
    await owner.query(`select ledger.correct($1, ledger.house(), 10, 'testing the floor')`, [
      ann.accountId,
    ]);
    expect(await balance(owner, ann.accountId)).toBe(0n);
    await expectBooksBalance(owner);
  });

  it('refuse money moving anywhere a trade cannot take it', async () => {
    const ann = await person(owner, '10');
    const raj = await person(owner, '10');
    await expect(
      owner.query(`select ledger.post('trade', null, null, $1)`, [
        JSON.stringify([{ from: ann.accountId, to: raj.accountId, amount: '1' }]),
      ]),
    ).rejects.toThrow();
    await expect(
      owner.query(`select ledger.correct($1, $2, 1, 'person to person')`, [
        ann.accountId,
        raj.accountId,
      ]),
    ).rejects.toThrow(/does not fit/);
    await expectBooksBalance(owner);
  });

  it('can only be reached through the trade functions by the app role', async () => {
    const ann = await person(owner, '10');
    for (const statement of [
      'select count(*) from ledger.accounts',
      'select count(*) from ledger.moves',
      'select count(*) from markets.trades',
      `insert into ledger.entries (kind, memo) values ('correction', 'x')`,
      `select ledger.grant_money(ledger.house(), 1, 'x')`,
      `select markets.settle(gen_random_uuid(), 'YES')`,
      `select markets.create_market(now(), 0.5, 10)`,
    ]) {
      await expect(
        transaction(app, (tx) => tx.query(statement), { account: ann.userId }),
        statement,
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('refuse a trade applied without its start, or with someone else signed in', async () => {
    const ann = await person(owner, '10');
    const id = await market(owner);
    await expect(
      transaction(
        app,
        (tx) =>
          tx.query('select markets.apply_trade($1)', [
            { request_id: randomUUID(), market_id: id, action: 'buy', params: {} },
          ]),
        { account: ann.userId },
      ),
    ).rejects.toThrow(/only after begin_trade/);
    await expect(
      transaction(
        app,
        (tx) =>
          tx.query('select markets.begin_trade($1, $2, $3, $4)', [
            randomUUID(),
            id,
            'buy',
            { outcome: 'YES', amount: '1.000000' },
          ]),
        { account: null },
      ),
    ).rejects.toThrow(/signed-in account/);
  });

  it('keep every amount to six places, exactly', async () => {
    const ann = await person(owner, '0.000003');
    const id = await market(owner);
    const result = traded(await buy(app, ann, id, 'NO', '0.000001'));
    expect(result.amount).toBe('0.000001');
    expect(decimal(await balance(owner, ann.accountId))).toBe('0.000002');
    await expectBooksBalance(owner);
  });
});
