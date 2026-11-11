import { describe, expect, it } from 'vitest';
import type { MarketState } from './plan.ts';
import { postgresDivideRound, probabilityOf, quoteTrade } from './quote.ts';

/**
 * A quote worked out by hand (PLAN.md step 3.5c). That it matches the trade that follows, to the
 * millionth, on a real database and over hundreds of random trades, is quote.db.test.ts's.
 */

const MARKET = '019a7100-0001-7000-8000-000000000001';
const REQUEST = '00000000-0000-4000-8000-0000000000aa';

function state(extra: Partial<MarketState> = {}): MarketState {
  return {
    now: '2026-11-11T09:00:00.000Z',
    market: {
      id: MARKET,
      state: 'open',
      closes_at: '2026-11-12T09:00:00.000Z',
      p: '0.50000000',
      pool_yes: '1000.000000',
      pool_no: '1000.000000',
      seed: '1000.000000',
    },
    account: { id: 'quote', balance: '25.000000' },
    position: { yes: '0', no: '0' },
    orders: [],
    balances: {},
    ...extra,
  };
}

describe('a quote', () => {
  it('for Ṁ25 of Yes at 50% in a Ṁ1,000 pool: 49.390243 shares, to about 51.23%', () => {
    const quote = quoteTrade(
      { action: 'buy', requestId: REQUEST, marketId: MARKET, outcome: 'YES', amount: '25' },
      state(),
    );
    expect(quote).toEqual({
      status: 'filled',
      amount: '25.000000',
      shares: '49.390243',
      orderAmount: '25.000000',
      limitProb: null,
      averagePrice: '0.50617285',
      probBefore: '0.50000000',
      // The pool: 1,025 No and 1,025 − 49.390243 = 975.609757 Yes; 1025 / 2000.609757 = 0.512343797…
      probAfter: '0.51234380',
      payout: '49.390243',
      pool: { yes: '975.609757', no: '1025.000000' },
    });
  });

  it('for a sale: the money it receives, as a negative amount and a positive payout', () => {
    const quote = quoteTrade(
      { action: 'sell', requestId: REQUEST, marketId: MARKET, outcome: 'YES', shares: '49.390243' },
      state({
        market: { ...state().market, pool_yes: '975.609757', pool_no: '1025.000000' },
        position: { yes: '49.390243', no: '0' },
      }),
    );
    if ('refusal' in quote) throw new Error('refused');
    expect(quote.status).toBe('filled');
    expect(quote.shares).toBe('-49.390243');
    expect(quote.amount.startsWith('-24.99999')).toBe(true);
    expect(quote.payout).toBe(quote.amount.slice(1));
    expect(quote.probAfter).toBe('0.50000000');
  });

  it('for a limit buy below the price: it would rest, filling nothing', () => {
    const quote = quoteTrade(
      {
        action: 'buy',
        requestId: REQUEST,
        marketId: MARKET,
        outcome: 'YES',
        amount: '10',
        limitProb: '0.4',
      },
      state({ account: { id: 'quote', balance: '10' } }),
    );
    expect(quote).toMatchObject({
      status: 'resting',
      amount: '0.000000',
      shares: '0.000000',
      orderAmount: '10.000000',
      limitProb: '0.40000000',
      averagePrice: null,
      probBefore: '0.50000000',
      probAfter: '0.50000000',
    });
  });

  it("is refused as the trade would be: a market that isn't open, or one past its closing", () => {
    const buy = {
      action: 'buy' as const,
      requestId: REQUEST,
      marketId: MARKET,
      outcome: 'YES' as const,
      amount: '1',
    };
    expect(quoteTrade(buy, state({ market: { ...state().market, state: 'closed' } }))).toEqual({
      refusal: 'market_not_open',
    });
    expect(quoteTrade(buy, state({ now: '2026-11-12T09:00:00.000Z' }))).toEqual({
      refusal: 'market_closed',
    });
  });
});

describe("the database's own rounding", () => {
  it('divides as Postgres does: the quotient at its own scale, then rounded to 8 places', () => {
    // 2 / 3 at scale 0: rounded at 16 places (…6667), then to 8: 0.66666667.
    expect(postgresDivideRound(2n, 3n, 0, 8)).toBe(66666667n);
    // 1 / 8 = 0.125 exactly: 0.12500000.
    expect(postgresDivideRound(1n, 8n, 0, 8)).toBe(12500000n);
    // Halves round away from zero: 0.000000005 → 0.00000001.
    expect(postgresDivideRound(5n, 1000000000n, 0, 8)).toBe(1n);
  });

  it('gives a pool its probability as markets.probability does', () => {
    expect(probabilityOf('0.50000000', 1000_000000n, 1000_000000n)).toBe('0.50000000');
    expect(probabilityOf('0.5', 90_909091n, 110_000000n)).toBe('0.54751131');
    expect(probabilityOf('0.37', 1000_000000n, 1000_000000n)).toBe('0.37000000');
  });
});
