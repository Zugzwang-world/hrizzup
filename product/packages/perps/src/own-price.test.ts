import { describe, expect, it } from 'vitest';
import { OWN_PRICE, planStep, type StepState, type StoredPoint } from './plan.ts';
import {
  OWN_PRICE_INTERVAL_MS,
  ownPriceDueAt,
  PerpNotSetUpError,
  priceFor,
  storedPrice,
} from './step.ts';

/**
 * The perp on our own Bitcoin price (PLAN.md step 3.4b), with no database: the newest stored price
 * read as the engine reads a price, whatever the moment; reads with none stored yet answering "not
 * set up"; when a waiting order looks again for the next; and a step applying exactly the newest
 * stored price, once, and filling an order at it. The database's own rules (only the price
 * begin_step handed over, an order filling only at a price asked for after it) are tested against
 * the migrations (infra/supabase/tests/bitcoin_price.test.sql).
 */

const PERP = '01a1c501-ec40-78f6-87b6-3fb041143421';
const LONG_POOL = '00000000-0000-4000-8000-00000000b001';
const SHORT_POOL = '00000000-0000-4000-8000-00000000b002';
const IVY = '00000000-0000-4000-8000-00000000b003';
const T = Date.parse('2026-11-11T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const point = (at: number, price: string, sources = 3): StoredPoint => ({
  at: iso(at),
  price,
  sources,
});

/** The listed perp on our own price, as begin_step hands it over: no position, Ṁ25,000 a pool. */
function stateAt(
  now: number,
  newest: StoredPoint | null,
  book: { price: string; at: number } | null,
  trader: { balance: string } | null = null,
): StepState {
  return {
    now: iso(now),
    step: 7,
    perp: {
      id: PERP,
      state: 'live',
      tradingMode: 'enabled',
      feed: OWN_PRICE,
      seed: null,
      standIn: { origin: '2026-01-01T00:00:00Z', startPrice: '100000', volatility: '0.55' },
      point: newest,
      settings: {
        maxLeverage: '10',
        takerFeeBps: '10',
        takerFeeImpact: '0',
        fundingPeriodMs: '3600000',
        fundingSensitivity: '1',
        maxFundingRate: '0.00011415525114155251',
        maxPriceAgeMs: '120000',
        subsidyLong: '25000',
        subsidyShort: '25000',
      },
      price: book?.price ?? null,
      priceAt: book ? iso(book.at) : null,
      fundingFrom: '2026-11-10T00:00:00Z',
      lastFundingAt: null,
      pausedReason: null,
      longAccountId: LONG_POOL,
      shortAccountId: SHORT_POOL,
    },
    pools: { long: '25000', short: '25000' },
    positions: [],
    trader: trader ? { accountId: IVY, balance: trader.balance } : null,
  };
}

const fromStore = (state: StepState) => () => storedPrice(state.perp.point);

describe('our own price, read', () => {
  it('reads a stored price as the engine reads a price, and none as none', () => {
    expect(storedPrice(point(T, '73342.17'))).toEqual({ ts: T, price: 73342.17 });
    expect(storedPrice(null)).toBeNull();
    expect(storedPrice(undefined)).toBeNull();
    expect(() => storedPrice({ at: 'yesterday', price: '1', sources: 3 })).toThrow();
    expect(() => storedPrice({ at: iso(T), price: '-1', sources: 3 })).toThrow();
  });

  it('gives the newest stored price whatever the moment, and "not set up" before the first', () => {
    const perp = {
      feed: OWN_PRICE,
      seed: null,
      standIn: { origin: '2026-01-01T00:00:00Z', startPrice: '100000', volatility: '0.55' },
      point: point(T, '73342.17'),
    };
    const at = priceFor(perp, { seed: undefined });
    expect(at(T + 60_000)).toEqual({ ts: T, price: 73342.17 });
    expect(at(0)).toEqual({ ts: T, price: 73342.17 });
    expect(() => priceFor({ ...perp, point: null }, { seed: undefined })).toThrow(
      PerpNotSetUpError,
    );
  });

  it('still prices a stand-in perp from its seed, never from a stored price', () => {
    const perp = {
      feed: 'stand-in-btc-usd',
      seed: '00112233aabbccdd',
      standIn: { origin: '2026-11-01T00:00:00Z', startPrice: '100', volatility: '0.4' },
      point: point(T, '73342.17'),
    };
    expect(priceFor(perp, { seed: undefined })(T).price).not.toBe(73342.17);
  });
});

describe('waiting for our next price', () => {
  it('looks again just after the next is due, never sooner than half a second on', () => {
    const newest = { ts: T, price: 73342.17 };
    expect(ownPriceDueAt(newest, T + 1_000, T + 1_000)).toBe(T + OWN_PRICE_INTERVAL_MS + 400);
    // Overdue (the exchanges slow, or prices stopped): every half second.
    expect(ownPriceDueAt(newest, T + 7_000, T + 7_000)).toBe(T + 7_500);
    // None stored yet: half a second on.
    expect(ownPriceDueAt(null, T, T)).toBe(T + 500);
  });
});

describe('a step on our own price', () => {
  it('applies the newest stored price once, and nothing when it is the book’s already', () => {
    const newest = point(T, '73342.17');
    const first = stateAt(T + 100, newest, { price: '74775.77', at: T - 3_600_000 });
    const plan = planStep(first, { action: 'tick' }, fromStore(first), () => 'unused');
    expect(plan?.price).toEqual({ at: iso(T), price: '73342.17' });
    const again = stateAt(T + 2_000, newest, { price: '73342.17', at: T });
    expect(planStep(again, { action: 'tick' }, fromStore(again), () => 'unused')).toBeNull();
  });

  it('applies nothing before the first stored price', () => {
    const state = stateAt(T, null, { price: '74775.77', at: T - 3_600_000 });
    expect(planStep(state, { action: 'tick' }, fromStore(state), () => 'unused')).toBeNull();
  });

  it('fills an order placed before the newest price at exactly that price', () => {
    const newest = point(T, '73342.17');
    const state = stateAt(
      T + 300,
      newest,
      { price: '73300.00', at: T - 5_000 },
      { balance: '1000' },
    );
    const plan = planStep(
      state,
      {
        action: 'open',
        requestId: '0b000000-0000-4000-8000-00000000b004',
        params: { direction: 'long', margin: '100', leverage: '10' },
        placedAt: iso(T - 1),
      },
      fromStore(state),
      () => '0b000000-0000-4000-8000-00000000b005',
    );
    expect(plan?.refusal).toBeUndefined();
    expect(plan?.price).toEqual({ at: iso(T), price: '73342.17' });
    expect(plan?.positions).toEqual([
      expect.objectContaining({ accountId: IVY, direction: 'long', entryPrice: '73342.17' }),
    ]);
  });
});
