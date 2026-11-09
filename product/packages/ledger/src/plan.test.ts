import { getBinaryCpmmBetInfo, TAKER_FEE_RATE } from '@hrizzup/market-engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decimal, down, fromNumber, micros } from './decimal.ts';
import {
  contractOf,
  type MarketState,
  ordersOf,
  paramsOf,
  planTrade,
  refusalFor,
  TradeInputError,
  type TradeRequest,
} from './plan.ts';

const MARKET = '0b9e5a54-1c1f-4f7e-9a51-7d2d8b6f3c01';
const ANN = 'a0000000-0000-4000-8000-000000000001';
const RAJ = 'a0000000-0000-4000-8000-000000000002';
const NOW = '2026-11-09T12:00:00.000+00:00';
const TRADE = 'c0000000-0000-4000-8000-000000000001';
let requests = 0;
const requestId = () => `d0000000-0000-4000-8000-${String(++requests).padStart(12, '0')}`;

/** A market as begin_trade hands it over: 1,000 Yes and 1,000 No in the pool, at 50%. */
function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    now: NOW,
    market: {
      id: MARKET,
      state: 'open',
      closes_at: '2026-12-01T00:00:00+00:00',
      p: '0.50000000',
      pool_yes: '1000.000000',
      pool_no: '1000.000000',
      seed: '1000.000000',
    },
    account: { id: ANN, balance: '500.000000' },
    position: { yes: '0.000000', no: '0.000000' },
    orders: [],
    balances: {},
    ...overrides,
  };
}

const buy = (amount: string, extra: Partial<Extract<TradeRequest, { action: 'buy' }>> = {}) =>
  ({
    action: 'buy',
    requestId: requestId(),
    marketId: MARKET,
    outcome: 'YES',
    amount,
    ...extra,
  }) as Extract<TradeRequest, { action: 'buy' }>;

const total = (parts: { amount: string }[] | undefined) =>
  (parts ?? []).reduce((sum, part) => sum + micros(part.amount), 0n);
const totalShares = (parts: { shares: string }[] | undefined) =>
  (parts ?? []).reduce((sum, part) => sum + micros(part.shares), 0n);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('The ledger read the clock');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a buy', () => {
  it("spends exactly what was asked, with Manifold's shares rounded down once", () => {
    const state = market();
    const plan = planTrade(buy('100'), state, TRADE);
    expect(plan.refusal).toBeUndefined();
    expect(total(plan.fills)).toBe(micros('100'));
    const info = getBinaryCpmmBetInfo(
      contractOf(state),
      'YES',
      100,
      undefined,
      [],
      {},
      undefined,
      undefined,
      Date.parse(NOW),
    );
    expect(totalShares(plan.fills)).toBe(down(info.newBet.shares));
    expect(totalShares(plan.fills)).toBe(micros('190.909090')); // 190.9090909…, the house's way
    expect(plan.pool).toEqual({
      yes: decimal(fromNumber(info.newPool.YES as number)),
      no: decimal(fromNumber(info.newPool.NO as number)),
    });
    expect(plan.pool?.no).toBe('1100.000000');
    expect(plan.trade).toMatchObject({ id: TRADE, outcome: 'YES', order_amount: '100.000000' });
    expect(plan.trade?.is_filled).toBe(true);
  });

  it('as a limit order below the price, rests without filling', () => {
    const plan = planTrade(buy('50', { limitProb: '0.4' }), market(), TRADE);
    expect(plan.fills).toEqual([]);
    expect(plan.trade).toMatchObject({ limit_prob: '0.40000000', is_filled: false });
    expect(plan.pool).toEqual({ yes: '1000.000000', no: '1000.000000' });
  });

  it('fills a resting order from the other side, and the order owner pays its part', () => {
    // Raj's order buys No once Yes reaches 60%.
    const state = market({
      account: { id: ANN, balance: '1000.000000' },
      orders: [
        {
          id: 'e0000000-0000-4000-8000-000000000001',
          account_id: RAJ,
          outcome: 'NO',
          order_amount: '40.000000',
          amount: '0.000000',
          shares: '0.000000',
          limit_prob: '0.60000000',
          expires_at: null,
          created_at: '2026-11-09T11:00:00.000+00:00',
        },
      ],
      balances: { [RAJ]: '500.000000' },
    });
    const plan = planTrade(buy('400'), state, TRADE);
    expect(plan.makers).toHaveLength(1);
    expect(plan.makers?.[0]).toMatchObject({
      order_id: 'e0000000-0000-4000-8000-000000000001',
      amount: '40.000000',
      shares: '100.000000',
    });
    expect(
      plan.fills?.some((fill) => fill.matched === 'e0000000-0000-4000-8000-000000000001'),
    ).toBe(true);
    expect(total(plan.fills)).toBe(micros('400'));
  });

  it("never takes an order's owner past their balance, and cancels the order", () => {
    const state = market({
      account: { id: ANN, balance: '1000.000000' },
      orders: [
        {
          id: 'e0000000-0000-4000-8000-000000000002',
          account_id: RAJ,
          outcome: 'NO',
          order_amount: '100.000000',
          amount: '0.000000',
          shares: '0.000000',
          limit_prob: '0.60000000',
          expires_at: null,
          created_at: '2026-11-09T11:00:00.000+00:00',
        },
      ],
      balances: { [RAJ]: '30.000000' },
    });
    const plan = planTrade(buy('400'), state, TRADE);
    expect(micros(plan.makers?.[0]?.amount ?? '0')).toBeLessThanOrEqual(micros('30'));
    expect(plan.cancel).toEqual(['e0000000-0000-4000-8000-000000000002']);
  });

  it('skips an order that has expired', () => {
    const state = market({
      account: { id: ANN, balance: '1000.000000' },
      orders: [
        {
          id: 'e0000000-0000-4000-8000-000000000003',
          account_id: RAJ,
          outcome: 'NO',
          order_amount: '100.000000',
          amount: '0.000000',
          shares: '0.000000',
          limit_prob: '0.60000000',
          expires_at: '2026-11-09T11:59:59.999+00:00',
          created_at: '2026-11-09T11:00:00.000+00:00',
        },
      ],
      balances: { [RAJ]: '500.000000' },
    });
    expect(planTrade(buy('400'), state, TRADE).makers).toEqual([]);
  });
});

describe('a sale', () => {
  it('sells exactly the shares asked for, money coming back', () => {
    const first = planTrade(buy('100'), market(), TRADE);
    const held = decimal(totalShares(first.fills));
    const after = market({
      market: {
        ...market().market,
        pool_yes: first.pool?.yes ?? '',
        pool_no: first.pool?.no ?? '',
      },
      account: { id: ANN, balance: '400.000000' },
      position: { yes: held, no: '0.000000' },
    });
    const plan = planTrade(
      { action: 'sell', requestId: requestId(), marketId: MARKET, outcome: 'YES', shares: held },
      after,
      TRADE,
    );
    expect(totalShares(plan.fills)).toBe(-micros(held));
    // Nobody else traded and there are no fees, so selling straight back returns the stake.
    expect(Number(total(plan.fills))).toBeCloseTo(-100_000_000, -1);
    // The pool is back where it started, but for the millionths rounding kept for the house.
    for (const side of [plan.pool?.yes, plan.pool?.no]) {
      const gap = micros(side ?? '0') - micros('1000');
      expect(gap >= -3n && gap <= 3n, side).toBe(true);
    }
  });
});

describe('rounding', () => {
  it('never gives a trader more than the maths: shares and money back are rounded down', () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 300; run++) {
      const pool = (100 + random() * 5000).toFixed(6);
      const state = market({
        market: {
          ...market().market,
          p: (0.1 + random() * 0.8).toFixed(8),
          pool_yes: pool,
          pool_no: (100 + random() * 5000).toFixed(6),
        },
        account: { id: ANN, balance: '10000.000000' },
        position: { yes: '500.000000', no: '0.000000' },
      });
      const spend = (0.000001 + random() * 300).toFixed(6);
      const bought = planTrade(buy(spend), state, TRADE);
      if (bought.refusal) continue;
      const exact = getBinaryCpmmBetInfo(
        contractOf(state),
        'YES',
        Number(spend),
        undefined,
        [],
        {},
        undefined,
        undefined,
        Date.parse(NOW),
      ).newBet;
      expect(Number(totalShares(bought.fills)) / 1e6).toBeLessThanOrEqual(exact.shares + 1e-12);
      expect(total(bought.fills)).toBeLessThanOrEqual(micros(spend));

      const selling = (0.000001 + random() * 500).toFixed(6);
      const sold = planTrade(
        {
          action: 'sell',
          requestId: requestId(),
          marketId: MARKET,
          outcome: 'YES',
          shares: selling,
        },
        state,
        TRADE,
      );
      expect(-totalShares(sold.fills)).toBeLessThanOrEqual(micros(selling));
      const back = -Number(total(sold.fills)) / 1e6;
      expect(back).toBeGreaterThanOrEqual(0);
      // Never more back than the shares sold are worth at the pool's best price.
      expect(back).toBeLessThanOrEqual(Number(selling));
    }
  });
});

describe('refusals', () => {
  it('refuses a market that is not open, or past its closing time', () => {
    const shut = market({ market: { ...market().market, state: 'closed' } });
    expect(planTrade(buy('10'), shut, TRADE).refusal).toBe('market_not_open');
    const late = market({ now: '2026-12-01T00:00:00.000+00:00' });
    expect(planTrade(buy('10'), late, TRADE).refusal).toBe('market_closed');
  });

  it('refuses more than the balance, for a buy and for a limit order', () => {
    expect(planTrade(buy('500.000001'), market(), TRADE).refusal).toBe('insufficient_balance');
    expect(planTrade(buy('600', { limitProb: '0.3' }), market(), TRADE).refusal).toBe(
      'insufficient_balance',
    );
    expect(planTrade(buy('500'), market(), TRADE).refusal).toBeUndefined();
  });

  it('refuses selling more shares than are held', () => {
    const request = {
      action: 'sell',
      requestId: requestId(),
      marketId: MARKET,
      outcome: 'NO',
      shares: '1',
    } as const;
    expect(refusalFor(request, market())).toBe('not_enough_shares');
  });

  it('refuses a sale that would leave a side of the pool almost empty', () => {
    // A thin pool at p = 0.9, where No's side carries little weight, and a big Yes position
    // sold back: it would push No's side down past what can be kept to a millionth.
    const thin = market({
      market: { ...market().market, p: '0.90000000', pool_yes: '0.500000', pool_no: '5.000000' },
      position: { yes: '400.000000', no: '0.000000' },
    });
    const plan = planTrade(
      { action: 'sell', requestId: requestId(), marketId: MARKET, outcome: 'YES', shares: '400' },
      thin,
      TRADE,
    );
    expect(plan.refusal).toBe('price_limit');
  });

  it('refuses a buy the pool cannot fill at all, at the 99% limit', () => {
    const pinned = market({
      market: { ...market().market, pool_yes: '1.000000', pool_no: '10000.000000' },
    });
    expect(contractOf(pinned).prob).toBeGreaterThan(0.99);
    expect(planTrade(buy('10'), pinned, TRADE).refusal).toBe('price_limit');
  });
});

describe('requests', () => {
  it('are stored in one form, so a retry matches', () => {
    expect(paramsOf(buy('12.5', { limitProb: '0.25', expiresAt: new Date(NOW) }))).toEqual({
      outcome: 'YES',
      amount: '12.500000',
      limitProb: '0.25000000',
      expiresAt: '2026-11-09T12:00:00.000Z',
    });
  });

  it('refuse what can never be traded, before reaching the database', () => {
    const bad: TradeRequest[] = [
      buy('0'),
      buy('-1'),
      buy('1.0000001'),
      buy('ten'),
      buy('10', { limitProb: '0.995' }),
      buy('10', { limitProb: '0.001' }),
      buy('10', { limitProb: '1' }),
      buy('10', { expiresAt: new Date(NOW) }),
      buy('10', { outcome: 'MAYBE' as 'YES' }),
      buy('10', { marketId: 'not-a-uuid' }),
      buy('10', { requestId: '1' }),
      { action: 'sell', requestId: requestId(), marketId: MARKET, outcome: 'YES', shares: '0' },
      { action: 'cancel_order', requestId: requestId(), marketId: MARKET, orderId: 'x' },
    ];
    for (const request of bad) expect(() => paramsOf(request)).toThrow(TradeInputError);
  });

  it('refuse a limit order that expires before the trade', () => {
    expect(() =>
      planTrade(buy('10', { limitProb: '0.4', expiresAt: new Date(NOW) }), market(), TRADE),
    ).toThrow(TradeInputError);
  });
});

describe('the maths, as the ledger hands it over', () => {
  it('sees the resting orders in the order they were placed', () => {
    const orders = ordersOf(
      market({
        orders: [
          {
            id: 'e0000000-0000-4000-8000-000000000009',
            account_id: RAJ,
            outcome: 'YES',
            order_amount: '10.000000',
            amount: '2.500000',
            shares: '5.000000',
            limit_prob: '0.50000000',
            expires_at: '2026-11-10T00:00:00.000+00:00',
            created_at: '2026-11-09T10:00:00.000+00:00',
          },
        ],
      }),
    );
    expect(orders[0]).toMatchObject({
      userId: RAJ,
      orderAmount: 10,
      amount: 2.5,
      shares: 5,
      limitProb: 0.5,
      expiresAt: Date.parse('2026-11-10T00:00:00.000Z'),
      createdTime: Date.parse('2026-11-09T10:00:00.000Z'),
    });
  });

  it('charges no fee: the setting stays at zero until a fee is decided', () => {
    expect(TAKER_FEE_RATE).toBe(0);
  });
});
