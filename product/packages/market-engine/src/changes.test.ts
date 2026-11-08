import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimitBet } from './manifold/bet.ts';
import { computeFills, getCpmmProbability } from './manifold/calculate-cpmm.ts';
import type { BinaryContract } from './manifold/contract.ts';
import type { ContractMetric } from './manifold/contract-metric.ts';
import { getFeeTotal, noFees, TAKER_FEE_RATE } from './manifold/fees.ts';
import { getBinaryCpmmBetInfo } from './manifold/new-bet.ts';
import { getNewContract } from './manifold/new-contract.ts';
import { getPayouts } from './manifold/payouts.ts';
import {
  getBinaryRedeemableAmountFromContractMetric,
  getRedemptionBets,
} from './manifold/redeem.ts';
import { getCpmmSellBetInfo } from './manifold/sell-bet.ts';

/**
 * What Hrizzup changed in Manifold's maths (README, "Hrizzup's changes"), each pinned by a test:
 * the time is passed in, there are no loans, the two error messages show their numbers, the
 * maths writes nothing to the console, and fees are zero behind one setting.
 */

const now = Date.UTC(2026, 10, 8, 12); // 8 November 2026, 12:00 UTC

const openMarket = (): BinaryContract =>
  getNewContract({
    id: 'market',
    visibility: 'public',
    creator: { id: 'house' },
    outcomeType: 'BINARY',
    initialProb: 50,
    ante: 1000,
    answers: [],
  }) as BinaryContract;

// A resting order to buy No once the price reaches 60%: it sells to Yes buyers at 60%.
const restingNoOrder = (expiresAt?: number): LimitBet => ({
  id: 'order',
  userId: 'maker',
  contractId: 'market',
  createdTime: now - 60_000,
  amount: 0,
  shares: 0,
  outcome: 'NO',
  probBefore: 0.5,
  probAfter: 0.5,
  fees: noFees,
  isRedemption: false,
  orderAmount: 100,
  limitProb: 0.6,
  isFilled: false,
  isCancelled: false,
  fills: [],
  expiresAt,
});

// A Yes buy of 300 at 50% passes 60% (about 225 reaches it), so it meets the resting order.
const buyYes = (orders: LimitBet[], at = now) =>
  getBinaryCpmmBetInfo(
    openMarket(),
    'YES',
    300,
    undefined,
    orders,
    { maker: 1000 },
    undefined,
    undefined,
    at,
  );

const position = (totalShares: { YES: number; NO: number }, loan = 0): ContractMetric => ({
  id: 1,
  userId: 'trader',
  contractId: 'market',
  answerId: null,
  lastBetTime: now,
  lastProb: 0.5,
  hasNoShares: totalShares.NO > 0,
  hasShares: true,
  hasYesShares: totalShares.YES > 0,
  invested: 0,
  loan,
  marginLoan: 0,
  maxSharesOutcome: 'YES',
  totalShares,
  totalSpent: undefined,
  payout: 0,
  totalAmountSold: 0,
  totalAmountInvested: 0,
  profit: 0,
  profitPercent: 0,
  from: undefined,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the time is passed in', () => {
  it('never reads the clock to buy, fill a limit order, sell, redeem or settle', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('The maths read the clock');
    });
    const market = openMarket();
    const buy = buyYes([restingNoOrder(now + 60_000)]);
    const traded = { ...market, pool: buy.newPool, p: buy.newP };
    getCpmmSellBetInfo(10, 'YES', traded, [], {}, undefined, now);
    getRedemptionBets(
      traded,
      10,
      getCpmmProbability(traded.pool, traded.p),
      undefined,
      'trader',
      now,
    );
    getPayouts(
      'YES',
      traded,
      [],
      [{ id: 'l', userId: 'house', contractId: 'market', createdTime: now, amount: 1000 }],
    );
  });

  it('stamps the bet and each of its fills with that time', () => {
    const { newBet } = buyYes([restingNoOrder()]);
    expect(newBet.createdTime).toBe(now);
    expect(newBet.fills?.length).toBe(2); // the pool, then the resting order
    for (const fill of newBet.fills ?? []) expect(fill.timestamp).toBe(now);
  });

  it('sets an order to expire a given time after it', () => {
    const { newBet } = getBinaryCpmmBetInfo(
      openMarket(),
      'YES',
      10,
      0.4,
      [],
      {},
      undefined,
      3_600_000,
      now,
    );
    expect(newBet.expiresAt).toBe(now + 3_600_000);
  });

  it('decides by that time whether a resting order has expired', () => {
    const expiresAt = now;
    expect(buyYes([restingNoOrder(expiresAt)], now - 1).makers).toHaveLength(1);
    expect(buyYes([restingNoOrder(expiresAt)], now).makers).toHaveLength(0);
  });
});

describe('there are no loans', () => {
  it('a sale carries none', () => {
    const { newBet } = getCpmmSellBetInfo(10, 'YES', openMarket(), [], {}, undefined, now);
    expect(newBet.loanAmount).toBe(0);
  });

  it('redeeming repays none, even if a position carried one', () => {
    expect(getBinaryRedeemableAmountFromContractMetric(position({ YES: 10, NO: 4 }, 5))).toEqual({
      shares: 4,
      loanPayment: 0,
      netAmount: 4,
    });
    const bets = getRedemptionBets(openMarket(), 4, 0.5, undefined, 'trader', now);
    expect(bets.map((b) => b.loanAmount)).toEqual([0, 0]);
  });
});

describe('the two error messages show their numbers', () => {
  const state = { pool: { YES: 1000, NO: 1000 }, p: 0.5, collectedFees: noFees };
  it('for the amount', () => {
    expect(() =>
      computeFills(state, 'YES', Number.NaN, undefined, [], {}, undefined, undefined, now),
    ).toThrow('Invalid bet amount: NaN');
  });
  it('for the limit price', () => {
    expect(() =>
      computeFills(state, 'YES', 10, Number.NaN, [], {}, undefined, undefined, now),
    ).toThrow('Invalid limitProb: NaN');
  });
});

describe('the maths writes nothing to the console', () => {
  it('to buy, sell, redeem or settle', () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const buy = buyYes([restingNoOrder()]);
    const traded = { ...openMarket(), pool: buy.newPool, p: buy.newP };
    getCpmmSellBetInfo(10, 'YES', traded, [], {}, undefined, now);
    getRedemptionBets(traded, 10, 0.5, undefined, 'trader', now);
    getPayouts('NO', traded, [position({ YES: 10, NO: 0 })], []);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('fees are zero, behind one setting', () => {
  it('the rate is zero', () => {
    expect(TAKER_FEE_RATE).toBe(0);
  });
  it('so a trade pays none, and the market collects none', () => {
    const { newBet } = buyYes([restingNoOrder()]);
    expect(getFeeTotal(newBet.fees)).toBe(0);
    for (const fill of newBet.fills ?? []) expect(getFeeTotal(fill.fees ?? noFees)).toBe(0);
    const sale = getCpmmSellBetInfo(10, 'YES', openMarket(), [], {}, undefined, now);
    expect(getFeeTotal(sale.fees)).toBe(0);
  });
});
