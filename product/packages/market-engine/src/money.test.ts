import { sumBy } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bet, LimitBet } from './manifold/bet.ts';
import { getContractBetMetrics } from './manifold/calculate.ts';
import { getCpmmProbability } from './manifold/calculate-cpmm.ts';
import type { BinaryContract } from './manifold/contract.ts';
import type { ContractMetric } from './manifold/contract-metric.ts';
import { getFeeTotal } from './manifold/fees.ts';
import type { LiquidityProvision } from './manifold/liquidity-provision.ts';
import { getBinaryCpmmBetInfo } from './manifold/new-bet.ts';
import { getNewContract } from './manifold/new-contract.ts';
import { getPayouts } from './manifold/payouts.ts';
import {
  getBinaryRedeemableAmountFromContractMetric,
  getRedemptionBets,
} from './manifold/redeem.ts';
import { getCpmmSellBetInfo } from './manifold/sell-bet.ts';
import { floatingEqual } from './manifold/util/math.ts';

/**
 * Our money tests (PLAN.md step 1.7a): play money is never created or lost. A small ledger
 * stands in for 1.7b's engine: it holds every account's balance, opens a yes/no market with
 * Hrizzup's starting amount (the house's), and applies what Manifold's maths returns for each
 * buy, limit order, sale, redemption and settlement, the way Manifold's server applies it.
 *
 * Two checks run after every step:
 *  - **money in equals money out:** the balances, the fees collected and the money held in the
 *    market always add up to what there was at the start, and after settlement the market holds
 *    nothing, so the balances and fees alone add up to the start;
 *  - **every share is backed:** each Ṁ1 in the market backs one Yes share and one No share, so
 *    the Yes shares outstanding (the pool's plus everyone's) equal the money in the market, and
 *    so do the No shares. That's what lets settlement pay every winning share Ṁ1.
 *
 * The clock throws throughout: the maths must take the time from the ledger.
 */

const start = Date.UTC(2026, 10, 8, 12); // 8 November 2026, 12:00 UTC
const ANTE = 1000; // What the house puts in to open each market
const HOUSE = 'house';
const FEES = 'fees'; // Where fees go (none while TAKER_FEE_RATE is 0)
// Rounding over a few thousand steps stays far below a millionth of a Ṁ1.
const TOLERANCE = 1e-6;

type Outcome = 'YES' | 'NO';
type Settlement = { outcome: 'YES' | 'NO' | 'CANCEL' } | { outcome: 'MKT'; probability: number };

class Ledger {
  now = start;
  balances: Record<string, number>;
  readonly total: number;
  market: BinaryContract;
  bets: Bet[] = [];
  liquidities: LiquidityProvision[];
  settled = false;
  private ids = 0;

  constructor(traders: Record<string, number>, initialProb = 50) {
    this.balances = { [HOUSE]: ANTE, [FEES]: 0, ...traders };
    this.total = sumBy(Object.values(this.balances));
    this.market = getNewContract({
      id: 'market',
      visibility: 'public',
      creator: { id: HOUSE },
      outcomeType: 'BINARY',
      initialProb,
      ante: ANTE,
      answers: [],
    }) as BinaryContract;
    this.balances[HOUSE] -= ANTE;
    this.liquidities = [
      {
        id: 'ante',
        userId: HOUSE,
        contractId: 'market',
        createdTime: this.now,
        isAnte: true,
        amount: ANTE,
      },
    ];
    this.check();
  }

  get probability() {
    return getCpmmProbability(this.market.pool, this.market.p);
  }

  get openOrders() {
    return this.bets.filter(
      (b): b is LimitBet => b.limitProb !== undefined && !b.isFilled && !b.isCancelled,
    );
  }

  /** The time moves on between steps, as it does between real trades. */
  tick(ms = 60_000) {
    this.now += ms;
  }

  /** A buy at the market, or a limit order when `limitProb` is given. Returns the new bet. */
  buy(userId: string, outcome: Outcome, amount: number, limitProb?: number, expiresAt?: number) {
    expect(amount).toBeLessThanOrEqual(this.balances[userId] + TOLERANCE);
    const result = getBinaryCpmmBetInfo(
      this.market,
      outcome,
      amount,
      limitProb,
      this.openOrders,
      this.balances,
      expiresAt,
      undefined,
      this.now,
    );
    const bet = { ...result.newBet, id: this.newId(), userId } as Bet;
    this.bets.push(bet);
    this.balances[userId] -= bet.amount;
    this.balances[FEES] += getFeeTotal(bet.fees);
    this.applyMakers(result.makers, bet.id);
    this.cancel(result.ordersToCancel);
    this.market = { ...this.market, pool: result.newPool, p: result.newP };
    this.redeemAll([userId, ...result.makers.map((m) => m.bet.userId)]);
    this.check();
    return bet;
  }

  /** Sells `shares` of one side back. */
  sell(userId: string, outcome: Outcome, shares: number) {
    const result = getCpmmSellBetInfo(
      shares,
      outcome,
      this.market,
      this.openOrders,
      this.balances,
      undefined,
      this.now,
    );
    const bet = { ...result.newBet, id: this.newId(), userId } as Bet;
    this.bets.push(bet);
    this.balances[userId] -= bet.amount; // A sale's amount is negative: money comes back
    this.balances[FEES] += getFeeTotal(bet.fees);
    this.applyMakers(result.makers, bet.id);
    this.cancel(result.ordersToCancel);
    this.market = { ...this.market, pool: result.newPool, p: result.newP };
    this.redeemAll([userId, ...result.makers.map((m) => m.bet.userId)]);
    this.check();
    return bet;
  }

  /** A trader withdraws a resting order; no money moves. */
  withdraw(order: LimitBet) {
    this.cancel([order]);
    this.check();
  }

  /** Yes and No held together cancel out, as Manifold does after every trade. */
  redeemAll(userIds: string[]) {
    for (const userId of new Set(userIds)) {
      const { shares, netAmount } = getBinaryRedeemableAmountFromContractMetric(
        this.position(userId),
      );
      if (floatingEqual(shares, 0)) continue;
      const bets = getRedemptionBets(
        this.market,
        shares,
        this.probability,
        undefined,
        userId,
        this.now,
      );
      this.bets.push(...bets.map((b) => ({ ...b, id: this.newId() })));
      expect(-sumBy(bets, 'amount')).toBeCloseTo(netAmount, 9);
      this.balances[userId] += netAmount;
    }
  }

  settle(settlement: Settlement) {
    const outcome = settlement.outcome;
    const probability = settlement.outcome === 'MKT' ? settlement.probability : undefined;
    this.market = {
      ...this.market,
      isResolved: true,
      resolution: outcome,
      resolutionProbability: probability,
    };
    const traders = [...new Set(this.bets.map((b) => b.userId))];
    const metrics = traders.map((userId) => this.position(userId));
    const { traderPayouts, liquidityPayouts } = getPayouts(
      outcome,
      this.market,
      metrics,
      this.liquidities,
      undefined,
      probability,
    );
    for (const { userId, payout } of [...traderPayouts, ...liquidityPayouts]) {
      // Only a cancel takes money back: from a trader who sold for more than they put in.
      if (outcome !== 'CANCEL') expect(payout).toBeGreaterThanOrEqual(-TOLERANCE);
      this.balances[userId] += payout;
    }
    this.settled = true;
    this.check();
    return { traderPayouts, liquidityPayouts };
  }

  /** A trader's position, as Manifold works it out from their bets. */
  position(userId: string): ContractMetric {
    const bets = this.bets.filter((b) => b.userId === userId);
    return {
      ...getContractBetMetrics(this.market, bets),
      id: 0,
      userId,
      loan: 0,
      marginLoan: 0,
      from: undefined,
    };
  }

  /** The money in the market: what there was at the start, less every balance and fee. */
  get held() {
    return this.total - sumBy(Object.values(this.balances));
  }

  check() {
    for (const [userId, balance] of Object.entries(this.balances))
      expect(balance, `${userId}'s balance`).toBeGreaterThanOrEqual(-TOLERANCE);
    if (this.settled) {
      expect(this.held, 'money left in a settled market').toBeCloseTo(0, 6);
      return;
    }
    const traders = [...new Set(this.bets.map((b) => b.userId))];
    const shares = (outcome: Outcome) =>
      this.market.pool[outcome] +
      sumBy(traders, (userId) => this.position(userId).totalShares[outcome] ?? 0);
    expect(Math.abs(shares('YES') - this.held), 'Yes shares backed').toBeLessThan(TOLERANCE);
    expect(Math.abs(shares('NO') - this.held), 'No shares backed').toBeLessThan(TOLERANCE);
    const p = this.probability;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  }

  private applyMakers(
    makers: { bet: LimitBet; amount: number; shares: number }[],
    takerId: string,
  ) {
    for (const maker of makers) {
      const order = this.bets.find((b) => b.id === maker.bet.id) as LimitBet;
      order.amount += maker.amount;
      order.shares += maker.shares;
      order.fills = [
        ...order.fills,
        { matchedBetId: takerId, amount: maker.amount, shares: maker.shares, timestamp: this.now },
      ];
      order.isFilled = floatingEqual(order.amount, order.orderAmount);
      this.balances[order.userId] -= maker.amount;
    }
  }

  private cancel(orders: LimitBet[]) {
    for (const { id } of orders) {
      const order = this.bets.find((b) => b.id === id) as LimitBet;
      order.isCancelled = true;
    }
  }

  private newId() {
    this.ids += 1;
    return `bet${this.ids}`;
  }
}

const everySettlement: Settlement[] = [
  { outcome: 'YES' },
  { outcome: 'NO' },
  { outcome: 'MKT', probability: 0.37 },
  { outcome: 'CANCEL' },
];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('The maths read the clock');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a yes/no buy', () => {
  for (const settlement of everySettlement) {
    it(`keeps every Ṁ1, settled ${settlement.outcome}`, () => {
      const ledger = new Ledger({ ann: 500, raj: 500 });
      const yes = ledger.buy('ann', 'YES', 200);
      expect(yes.shares).toBeGreaterThan(200); // Bought below Ṁ1 a share
      expect(ledger.probability).toBeGreaterThan(0.5);
      ledger.tick();
      ledger.buy('raj', 'NO', 120);
      ledger.settle(settlement);
    });
  }

  it('pays each winning share Ṁ1, and the house what the pool holds', () => {
    const ledger = new Ledger({ ann: 500 });
    const yes = ledger.buy('ann', 'YES', 200);
    const pool = ledger.market.pool.YES;
    const { traderPayouts, liquidityPayouts } = ledger.settle({ outcome: 'YES' });
    expect(traderPayouts).toEqual([{ userId: 'ann', payout: yes.shares }]);
    expect(liquidityPayouts).toEqual([{ userId: HOUSE, payout: pool }]);
  });

  it('cancelled, gives everyone back exactly what they put in', () => {
    const ledger = new Ledger({ ann: 500, raj: 500 });
    ledger.buy('ann', 'YES', 200);
    ledger.buy('raj', 'NO', 50);
    ledger.settle({ outcome: 'CANCEL' });
    expect(ledger.balances.ann).toBeCloseTo(500, 9);
    expect(ledger.balances.raj).toBeCloseTo(500, 9);
    expect(ledger.balances[HOUSE]).toBeCloseTo(ANTE, 9); // The starting amount comes back
  });
});

describe('a limit order', () => {
  // Raj's order buys No once the price reaches 60%, so it sells to Yes buyers at 60%.
  for (const settlement of everySettlement) {
    it(`filled in full keeps every Ṁ1, settled ${settlement.outcome}`, () => {
      const ledger = new Ledger({ ann: 1000, raj: 500 });
      const order = ledger.buy('raj', 'NO', 40, 0.6) as LimitBet;
      expect(order.amount).toBe(0); // Resting: the market is at 50%
      ledger.tick();
      ledger.buy('ann', 'YES', 400); // Takes the pool to 60%, then the whole order
      const filled = ledger.bets.find((b) => b.id === order.id) as LimitBet;
      expect(filled.isFilled).toBe(true);
      expect(filled.amount).toBeCloseTo(40, 9);
      expect(filled.shares).toBeCloseTo(40 / 0.4, 9); // No at 40%, Ṁ0.40 a share
      expect(ledger.balances.raj).toBeCloseTo(460, 9);
      ledger.settle(settlement);
    });

    it(`partly filled keeps every Ṁ1, settled ${settlement.outcome}`, () => {
      const ledger = new Ledger({ ann: 1000, raj: 500 });
      const order = ledger.buy('raj', 'NO', 300, 0.6) as LimitBet;
      ledger.tick();
      ledger.buy('ann', 'YES', 300); // About 225 reaches 60%; the rest fills part of the order
      const partly = ledger.bets.find((b) => b.id === order.id) as LimitBet;
      expect(partly.isFilled).toBe(false);
      expect(partly.amount).toBeGreaterThan(0);
      expect(partly.amount).toBeLessThan(300);
      expect(ledger.balances.raj).toBeCloseTo(500 - partly.amount, 9); // Only the filled part
      expect(ledger.probability).toBeCloseTo(0.6, 9); // The order holds the price
      ledger.tick();
      ledger.withdraw(partly); // The rest is withdrawn: no money moves
      expect(ledger.balances.raj).toBeCloseTo(500 - partly.amount, 9);
      ledger.settle(settlement);
    });
  }

  it("never fills once it's expired, and moves no money", () => {
    const ledger = new Ledger({ ann: 1000, raj: 500 });
    ledger.buy('raj', 'NO', 100, 0.6, start + 30_000);
    ledger.tick(); // A minute later, past its expiry
    ledger.buy('ann', 'YES', 400);
    expect(ledger.balances.raj).toBe(500);
    expect(ledger.probability).toBeGreaterThan(0.6);
    ledger.settle({ outcome: 'NO' });
  });

  it("stops filling when its owner's money runs out, and the rest is cancelled", () => {
    const ledger = new Ledger({ ann: 1000, raj: 130 });
    const order = ledger.buy('raj', 'NO', 100, 0.6) as LimitBet;
    ledger.tick();
    ledger.buy('raj', 'NO', 100); // Raj spends most of the money behind the order
    ledger.tick();
    ledger.buy('ann', 'YES', 400);
    const capped = ledger.bets.find((b) => b.id === order.id) as LimitBet;
    expect(capped.amount).toBeCloseTo(30, 9);
    expect(capped.isCancelled).toBe(true);
    expect(ledger.balances.raj).toBeCloseTo(0, 9);
    ledger.settle({ outcome: 'YES' });
  });
});

describe('a sale', () => {
  for (const settlement of everySettlement) {
    it(`keeps every Ṁ1, settled ${settlement.outcome}`, () => {
      const ledger = new Ledger({ ann: 500, raj: 500 });
      const yes = ledger.buy('ann', 'YES', 200);
      ledger.tick();
      ledger.buy('raj', 'NO', 100);
      ledger.tick();
      const sale = ledger.sell('ann', 'YES', yes.shares / 2);
      expect(sale.amount).toBeLessThan(0); // Money back
      expect(sale.shares).toBeCloseTo(-yes.shares / 2, 9);
      ledger.settle(settlement);
    });
  }

  it('selling everything straight back returns the whole stake', () => {
    const ledger = new Ledger({ ann: 500 });
    const yes = ledger.buy('ann', 'YES', 200);
    ledger.sell('ann', 'YES', yes.shares);
    expect(ledger.balances.ann).toBeCloseTo(500, 6); // No fees, nobody else traded
    expect(ledger.probability).toBeCloseTo(0.5, 9);
    ledger.settle({ outcome: 'YES' });
    expect(ledger.balances.ann).toBeCloseTo(500, 6);
  });

  it('can sell into a resting order', () => {
    const ledger = new Ledger({ ann: 1000, raj: 500 });
    const yes = ledger.buy('ann', 'YES', 300);
    ledger.buy('raj', 'YES', 100, 0.55); // Buys Yes if the price falls to 55%
    ledger.tick();
    ledger.sell('ann', 'YES', yes.shares);
    expect(ledger.position('raj').totalShares.YES).toBeGreaterThan(0);
    ledger.settle({ outcome: 'NO' });
  });
});

describe('Yes and No cancelling out', () => {
  for (const settlement of everySettlement) {
    it(`pays Ṁ1 for each pair and keeps every Ṁ1, settled ${settlement.outcome}`, () => {
      const ledger = new Ledger({ ann: 500 });
      const yes = ledger.buy('ann', 'YES', 100);
      ledger.tick();
      const before = ledger.balances.ann;
      const no = ledger.buy('ann', 'NO', 100); // Ann now holds both sides
      const pairs = Math.min(yes.shares, no.shares);
      expect(ledger.balances.ann).toBeCloseTo(before - 100 + pairs, 9);
      const { totalShares } = ledger.position('ann');
      expect(Math.min(totalShares.YES, totalShares.NO)).toBeCloseTo(0, 9);
      ledger.settle(settlement);
    });
  }
});

describe('a cancelled market', () => {
  it('takes back what a trader sold for beyond what they put in', () => {
    // Manifold's cancel pays each trader what they put in less what they took out, so a trader
    // who sold at a profit pays the profit back: a negative payout. Within one market that only
    // returns everyone to where they started; every Ṁ1 is kept.
    const ledger = new Ledger({ ann: 500, raj: 1000 });
    const yes = ledger.buy('ann', 'YES', 100);
    ledger.buy('raj', 'YES', 800); // The price rises
    ledger.sell('ann', 'YES', yes.shares); // Ann sells at a profit
    const profit = ledger.balances.ann - 500;
    expect(profit).toBeGreaterThan(0);
    const { traderPayouts } = ledger.settle({ outcome: 'CANCEL' });
    const paid = Object.fromEntries(traderPayouts.map((p) => [p.userId, p.payout]));
    expect(paid.ann).toBeCloseTo(-profit, 9);
    expect(ledger.balances.ann).toBeCloseTo(500, 9);
    expect(ledger.balances.raj).toBeCloseTo(1000, 9);
    expect(ledger.balances[HOUSE]).toBeCloseTo(ANTE, 9);
  });
});

describe('settlement', () => {
  it('at a set probability pays each share its share of Ṁ1', () => {
    const ledger = new Ledger({ ann: 500, raj: 500 });
    const yes = ledger.buy('ann', 'YES', 200);
    const no = ledger.buy('raj', 'NO', 300);
    const { traderPayouts } = ledger.settle({ outcome: 'MKT', probability: 0.25 });
    const paid = Object.fromEntries(traderPayouts.map((p) => [p.userId, p.payout]));
    expect(paid.ann).toBeCloseTo(yes.shares * 0.25, 9);
    expect(paid.raj).toBeCloseTo(no.shares * 0.75, 9);
  });

  it('of a market nobody traded gives the house its starting amount back', () => {
    for (const settlement of everySettlement) {
      const ledger = new Ledger({});
      ledger.settle(settlement);
      expect(ledger.balances[HOUSE]).toBeCloseTo(ANTE, 9);
    }
  });
});

// A small seeded random generator (mulberry32), so every run repeats exactly.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('long random sequences of trades', () => {
  const traders = ['ann', 'raj', 'mei', 'sam', 'zoe'];

  const run = (seed: number, steps: number) => {
    const rng = random(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)] as T;
    const ledger = new Ledger(
      Object.fromEntries(traders.map((t) => [t, 200 + Math.round(rng() * 2000)])),
      pick([10, 25, 50, 75, 90]),
    );
    const done = { buys: 0, orders: 0, sales: 0, withdrawals: 0 };
    for (let step = 0; step < steps; step++) {
      ledger.tick(Math.round(rng() * 600_000));
      const userId = pick(traders);
      const balance = ledger.balances[userId];
      const action = rng();
      if (action < 0.35 && balance >= 1) {
        ledger.buy(userId, pick(['YES', 'NO']), Math.min(balance, 1 + rng() * 300));
        done.buys++;
      } else if (action < 0.6 && balance >= 1) {
        const limit = Math.round((0.02 + rng() * 0.96) * 100) / 100;
        const expiresAt = rng() < 0.3 ? ledger.now + Math.round(rng() * 3_600_000) : undefined;
        ledger.buy(
          userId,
          pick(['YES', 'NO']),
          Math.min(balance, 1 + rng() * 200),
          limit,
          expiresAt,
        );
        done.orders++;
      } else if (action < 0.9) {
        const { totalShares } = ledger.position(userId);
        const held = (['YES', 'NO'] as const).filter((o) => (totalShares[o] ?? 0) > 1e-6);
        if (held.length === 0) continue;
        const outcome = pick([...held]);
        const shares = totalShares[outcome] as number;
        ledger.sell(userId, outcome, rng() < 0.3 ? shares : shares * rng());
        done.sales++;
      } else {
        const mine = ledger.openOrders.filter((o) => o.userId === userId);
        if (mine.length === 0) continue;
        ledger.withdraw(pick(mine));
        done.withdrawals++;
      }
    }
    const settlement = pick<Settlement>([
      { outcome: 'YES' },
      { outcome: 'NO' },
      { outcome: 'MKT', probability: Math.round(rng() * 100) / 100 },
      { outcome: 'MKT', probability: ledger.probability },
      { outcome: 'CANCEL' },
    ]);
    ledger.settle(settlement);
    return { done, settlement: settlement.outcome };
  };

  it('keep every Ṁ1 over 40 markets of 150 trades each, whatever the settlement', () => {
    const settled = new Set<string>();
    let trades = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { done, settlement } = run(seed, 150);
      trades += done.buys + done.orders + done.sales;
      settled.add(settlement);
    }
    expect(trades).toBeGreaterThan(40 * 100); // Most steps traded
    expect([...settled].sort()).toEqual(['CANCEL', 'MKT', 'NO', 'YES']);
  });

  it('keep every Ṁ1 over one market of 2,000 trades', () => {
    const { done } = run(2026, 2000);
    expect(done.orders).toBeGreaterThan(300);
    expect(done.sales).toBeGreaterThan(300);
  });
});
