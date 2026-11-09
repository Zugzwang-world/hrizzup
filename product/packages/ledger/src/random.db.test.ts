import { randomUUID } from 'node:crypto';
import { type ContractMetric, getPayouts, type LiquidityProvision } from '@hrizzup/market-engine';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decimal, fromNumber, type Micros, micros } from './decimal.ts';
import { contractOf, type MarketState } from './plan.ts';
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
} from './testing.ts';
import { trade } from './trade.ts';

/**
 * Long random runs (the Database check): thousands of trades of every kind (buys, limit orders
 * with and without expiry, sales, withdrawn orders) across several markets at once, with
 * markets settling every way (Yes, No, a set probability, cancelled) and new ones opening.
 * After every single step, the books must have no problem (ledger.problems()): they sum to zero,
 * every balance equals its lines, every share is backed by Ṁ1 in its market, every settled
 * market holds nothing, and nobody is below zero but through a cancel. Every settlement is also
 * checked against Manifold's own payout maths.
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

// A small seeded random generator (mulberry32), so every run makes the same choices.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Settlement = 'YES' | 'NO' | 'MKT' | 'CANCEL';

/** Settles a market and checks the database paid what Manifold's maths pays, to a millionth. */
async function settleAndCompare(id: string, resolution: Settlement, probability?: string) {
  const { rows: state } = await owner.query<{ s: MarketState['market'] }>(
    `select jsonb_build_object('id', m.id, 'state', m.state, 'closes_at', m.closes_at,
       'p', m.p::text, 'pool_yes', m.pool_yes::text, 'pool_no', m.pool_no::text,
       'seed', m.seed::text) as s
     from markets.markets m where m.id = $1`,
    [id],
  );
  const { rows: held } = await owner.query<{ account_id: string; yes: string; no: string }>(
    `select account_id, yes_shares::text as yes, no_shares::text as no
     from markets.positions where market_id = $1`,
    [id],
  );
  const contract = contractOf({ market: state[0]?.s } as MarketState);
  const metrics = held.map(
    (row) =>
      ({
        userId: row.account_id,
        totalShares: { YES: Number(row.yes), NO: Number(row.no) },
      }) as unknown as ContractMetric,
  );
  const house = 'house';
  const liquidities: LiquidityProvision[] = [
    {
      id: 'seed',
      userId: house,
      contractId: id,
      createdTime: 0,
      isAnte: true,
      amount: contract.totalLiquidity,
    },
  ];
  await settle(owner, id, resolution, probability);
  if (resolution === 'CANCEL') return; // A cancel pays back the books themselves (checked below).

  const { rows: paid } = await owner.query<{ account_id: string; amount: string; kind: string }>(
    `select m.to_account as account_id, m.amount::text, a.kind
     from ledger.moves m
     join ledger.entries e on e.id = m.entry_id
     join ledger.accounts a on a.id = m.to_account
     where e.market_id = $1 and e.kind = 'settle'`,
    [id],
  );
  const theirs = getPayouts(
    resolution,
    contract,
    metrics,
    liquidities,
    undefined,
    probability === undefined ? undefined : Number(probability),
  );
  for (const { userId, payout } of theirs.traderPayouts) {
    const ours = paid.find((row) => row.account_id === userId)?.amount ?? '0';
    const gap = micros(ours) - fromNumber(payout);
    expect(gap <= 1n && gap >= -1n, `payout to ${userId}: ${ours} vs ${payout}`).toBe(true);
  }
  const toHouse = paid
    .filter((row) => row.kind === 'house')
    .reduce((s, r) => s + micros(r.amount), 0n);
  const houseShare = theirs.liquidityPayouts.reduce((s, p) => s + p.payout, 0);
  const gap = toHouse - fromNumber(houseShare);
  // Each person's payout is rounded once; the house takes what that leaves.
  expect(gap <= BigInt(held.length) + 1n && gap >= -BigInt(held.length) - 1n).toBe(true);
}

/**
 * Resting orders on the wrong side of their market's price: a Yes order still waiting though Yes
 * costs less than its limit, or a No order though Yes costs more. Manifold's maths assumes there
 * are none (its sale maths prices from the pool), so there must never be any beyond what one
 * trade's rounding can move a price: the database's own allowance, which grows as a pool thins
 * (0.000001 + 0.25 × Ṁ0.001 × (1/y + 1/n) at the most; apply_trade).
 */
async function crossed(): Promise<string[]> {
  const { rows } = await owner.query<{ id: string }>(
    `select t.id from markets.trades t join markets.markets m on m.id = t.market_id
     cross join lateral (
       select markets.probability(m.p, m.pool_yes, m.pool_no) as prob,
              0.000001 + 0.25 * 0.001 * (1 / m.pool_yes + 1 / m.pool_no) as allowed
     ) x
     where m.state = 'open' and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
       and (t.expires_at is null or t.expires_at > now())
       and case when t.outcome = 'YES' then x.prob < t.limit_prob - x.allowed
                else x.prob > t.limit_prob + x.allowed
           end`,
  );
  return rows.map((row) => row.id);
}

describe('long random runs', () => {
  const run = async (seed: number, steps: number) => {
    const rng = random(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)] as T;
    const amount = (most: Micros, cap: number): Micros => {
      const wanted = fromNumber(0.000001 + rng() * cap);
      return wanted < most ? wanted : most;
    };
    const closesAt = new Date(Date.now() + 86_400_000);
    const traders: Person[] = [];
    for (let i = 0; i < 6; i++) {
      traders.push(await person(owner, decimal(fromNumber(200 + rng() * 2000))));
    }
    const open: string[] = [];
    // Markets of every depth, down to a Ṁ5 seed, whose pools get thin.
    const openMarket = async () =>
      open.push(
        await market(owner, {
          probability: pick(['0.1', '0.25', '0.5', '0.75', '0.9']),
          seed: pick(['5', '100', '1000', '1000']),
          closesAt,
        }),
      );
    for (let i = 0; i < 3; i++) await openMarket();
    const done = { buys: 0, orders: 0, sales: 0, withdrawals: 0, refused: 0, settled: 0 };
    const settledWith = new Set<string>();

    for (let step = 0; step < steps; step++) {
      const who = pick(traders);
      const id = pick(open);
      const action = rng();
      const money = await balance(owner, who.accountId);
      if (money < micros('1') && (money <= 0n || rng() < 0.5)) {
        await owner.query(`select ledger.grant_money($1, 500, 'a top-up for the test')`, [
          who.accountId,
        ]);
      } else if (action < 0.32) {
        const result = await buy(app, who, id, pick(['YES', 'NO']), amount(money, 300));
        if (result.status === 'refused') done.refused++;
        else done.buys++;
      } else if (action < 0.56) {
        const limitProb = (Math.round((0.02 + rng() * 0.96) * 100) / 100).toFixed(2);
        // Some orders expire within a few seconds, by the database's own clock, while the run goes on.
        const expiresAt =
          rng() < 0.3 ? new Date(Date.now() + 500 + Math.round(rng() * 4_000)) : undefined;
        const result = await buy(app, who, id, pick(['YES', 'NO']), amount(money, 200), {
          limitProb,
          ...(expiresAt ? { expiresAt } : {}),
        });
        if (result.status === 'refused') done.refused++;
        else done.orders++;
      } else if (action < 0.86) {
        const held = await position(owner, id, who.accountId);
        const side = held.yes > 0n ? 'YES' : held.no > 0n ? 'NO' : undefined;
        if (!side) continue;
        const shares = side === 'YES' ? held.yes : held.no;
        const part = rng() < 0.3 ? shares : (shares * BigInt(Math.floor(rng() * 1000))) / 1000n;
        if (part <= 0n) continue;
        const result = await sell(app, who, id, side, part);
        if (result.status === 'refused') done.refused++;
        else done.sales++;
      } else if (action < 0.97) {
        const { rows } = await owner.query<{ id: string }>(
          `select id from markets.trades
           where market_id = $1 and account_id = $2 and limit_prob is not null
             and not is_filled and not is_cancelled`,
          [id, who.accountId],
        );
        if (rows.length === 0) continue;
        const result = await trade(app, who.userId, {
          action: 'cancel_order',
          requestId: randomUUID(),
          marketId: id,
          orderId: pick(rows).id,
        });
        if (result.status === 'cancelled') done.withdrawals++;
      } else {
        const resolution = pick<Settlement>(['YES', 'NO', 'MKT', 'CANCEL']);
        await settleAndCompare(
          id,
          resolution,
          resolution === 'MKT' ? (Math.round(rng() * 100) / 100).toFixed(2) : undefined,
        );
        settledWith.add(resolution);
        done.settled++;
        open.splice(open.indexOf(id), 1);
        await openMarket();
      }
      await expectBooksBalance(owner, `after step ${step} of run ${seed}`);
      expect(await crossed(), `after step ${step} of run ${seed}`).toEqual([]);
    }
    for (const [i, id] of open.entries()) {
      const resolution = (['YES', 'NO', 'MKT', 'CANCEL'] as const)[(seed + i) % 4] as Settlement;
      await settleAndCompare(id, resolution, resolution === 'MKT' ? '0.37' : undefined);
      settledWith.add(resolution);
      done.settled++;
    }
    await expectBooksBalance(owner, `after run ${seed}`);
    return { done, settledWith };
  };

  it('keep the books over thousands of trades and every kind of settlement', {
    timeout: 600_000,
  }, async () => {
    let trades = 0;
    const settledWith = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const { done, settledWith: these } = await run(seed, 1200);
      trades += done.buys + done.orders + done.sales + done.withdrawals;
      for (const s of these) settledWith.add(s);
      expect(done.sales).toBeGreaterThan(100);
      expect(done.orders).toBeGreaterThan(100);
    }
    expect(trades).toBeGreaterThan(2000);
    expect([...settledWith].sort()).toEqual(['CANCEL', 'MKT', 'NO', 'YES']);
  });
});
