import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePosition, openPosition } from '../manifold/perps/amm.ts';
import {
  PERP_TAKER_FEE_BPS_DEFAULT,
  PERP_TAKER_FEE_IMPACT_DEFAULT,
} from '../manifold/perps/fees.ts';
import { HOUR_MS, MINUTE_MS, YEAR_MS } from '../manifold/util/time.ts';
import {
  applyPerpFunding,
  applyPerpPrice,
  closePerpPosition,
  newPerpBook,
  openPerpPosition,
  type PerpBook,
  type PerpOpenRequest,
} from './engine.ts';
import { assertPerpSettings, PERP_LEVERAGE_CAP, PERP_SETTINGS } from './settings.ts';
import { halfSipHash, STAND_IN_PRICE, standInPrice } from './stand-in-price.ts';

// Milestone 2's changes to the perps maths (README, "Hrizzup's changes"), each pinned here.
// The clock throws in every test: nothing may read it.
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('the perps maths read the clock');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const START = STAND_IN_PRICE.origin + 10 * 24 * HOUR_MS;
const SEED = '00000000000000a1';

/** A new perp at the stand-in price, a step after START. */
const freshBook = (): PerpBook => {
  const { price, ts } = standInPrice(SEED, START);
  return newPerpBook({
    contractId: 'perp-btc',
    feedId: STAND_IN_PRICE.feedId,
    settings: PERP_SETTINGS,
    price,
    priceTime: ts,
    now: ts,
  });
};

/** An open placed just before the book's price, so it fills at that price. */
const order = (book: PerpBook, over: Partial<PerpOpenRequest> = {}): PerpOpenRequest => ({
  userId: 'ana',
  direction: 'long',
  margin: 100,
  leverage: 5,
  placedTime: book.priceTime - 1,
  ...over,
});

const open = (book: PerpBook, over: Partial<PerpOpenRequest> = {}, balance = 1_000) =>
  openPerpPosition({
    book,
    settings: PERP_SETTINGS,
    tradingMode: 'enabled',
    request: order(book, over),
    balance,
    now: book.priceTime,
  });

const mustOpen = (book: PerpBook, over: Partial<PerpOpenRequest> = {}, balance = 1_000) => {
  const result = open(book, over, balance);
  if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
  return result;
};

describe('the time is passed in, never read from the clock', () => {
  it("Manifold's open and close stamp the time they are given", () => {
    const state = { pool: { L: 100, S: 100 }, positions: [] };
    const opened = openPosition(state, 'u', 'c', 'long', 10, 2, 50, undefined, 1_234);
    expect(opened.position.openedTime).toBe(1_234);
    expect(opened.position.updatedTime).toBe(1_234);
    const part = closePosition(opened.state, opened.position, 50, 0.5, 5_678);
    expect(part.remainingPosition?.updatedTime).toBe(5_678);
    expect(part.remainingPosition?.openedTime).toBe(1_234);
  });

  it('opening, closing part, a new price and funding all run with the clock throwing', () => {
    let book = mustOpen(freshBook()).book;
    book = mustOpen(book, { userId: 'ben', direction: 'short', margin: 50, leverage: 2 }).book;
    const later = standInPrice(SEED, START + 2 * HOUR_MS);
    book = applyPerpPrice({ book, price: later.price, priceTime: later.ts }).book;
    const funded = applyPerpFunding({ book, settings: PERP_SETTINGS, now: later.ts });
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;
    const position = funded.book.state.positions.find((p) => p.userId === 'ana');
    const closed = closePerpPosition({
      book: funded.book,
      settings: PERP_SETTINGS,
      tradingMode: 'enabled',
      request: {
        userId: 'ana',
        direction: 'long',
        fraction: 0.5,
        expectedSize: position?.size,
        placedTime: later.ts - 1,
      },
      now: later.ts,
    });
    expect(closed.ok).toBe(true);
  });
});

describe("the perp's settings: Manifold's defaults, with the 10 times cap", () => {
  it("are Manifold's opening fee and hourly funding, and its Bitcoin perp's recommendations", () => {
    expect(PERP_SETTINGS).toEqual({
      maxLeverage: 10,
      takerFeeBps: 10,
      takerFeeImpact: 0,
      fundingPeriodMs: HOUR_MS,
      fundingSensitivity: 1,
      maxFundingRate: HOUR_MS / YEAR_MS,
      maxPriceAgeMs: 2 * MINUTE_MS,
      subsidyLong: 25_000,
      subsidyShort: 25_000,
    });
    expect(PERP_SETTINGS.takerFeeBps).toBe(PERP_TAKER_FEE_BPS_DEFAULT);
    expect(PERP_SETTINGS.takerFeeImpact).toBe(PERP_TAKER_FEE_IMPACT_DEFAULT);
    expect(PERP_LEVERAGE_CAP).toBe(10);
    expect(() => assertPerpSettings(PERP_SETTINGS)).not.toThrow();
  });

  it('refuse settings past the cap or past the bounds Manifold enforces', () => {
    const bad = [
      { maxLeverage: 11 },
      { maxLeverage: 0.5 },
      { takerFeeBps: 101 },
      { takerFeeImpact: -1 },
      { maxFundingRate: 1 },
      { fundingSensitivity: 0 },
      { fundingPeriodMs: 30 * MINUTE_MS },
      { maxPriceAgeMs: 0 },
      { subsidyShort: 0 },
    ];
    for (const change of bad)
      expect(
        () => assertPerpSettings({ ...PERP_SETTINGS, ...change }),
        JSON.stringify(change),
      ).toThrow();
  });

  it('charge the opening fee: 0.1% of the size, into the trader’s own side of the pool', () => {
    const book = freshBook();
    const opened = mustOpen(book, { margin: 100, leverage: 10 });
    expect(opened.fee).toBeCloseTo(1, 12); // 0.1% of 1,000
    expect(opened.book.state.pool.L).toBeCloseTo(25_000 + 100 + 1, 9);
    expect(opened.book.state.pool.S).toBe(25_000);
    expect(opened.moves).toEqual([
      { userId: 'ana', kind: 'margin', amount: 100 },
      { userId: 'ana', kind: 'fee', amount: opened.fee },
    ]);
  });
});

describe('the 10 times cap refuses more', () => {
  it('opens at 10 times and refuses anything above, changing nothing', () => {
    const book = freshBook();
    expect(open(book, { leverage: 10 }).ok).toBe(true);
    for (const leverage of [10.000001, 11, 20, 100]) {
      const refused = open(book, { leverage });
      expect(refused).toMatchObject({ ok: false, refusal: { code: 'leverage_too_high' } });
    }
    expect(book.state.positions).toEqual([]);
  });

  it('follows the settings when they set a lower cap', () => {
    const settings = { ...PERP_SETTINGS, maxLeverage: 5 };
    const book = freshBook();
    const request = order(book, { leverage: 6 });
    const refused = openPerpPosition({
      book,
      settings,
      tradingMode: 'enabled',
      request,
      balance: 1_000,
      now: book.priceTime,
    });
    expect(refused).toMatchObject({ ok: false, refusal: { code: 'leverage_too_high' } });
  });

  it('refuses leverage below 1 and amounts that are not positive', () => {
    const book = freshBook();
    for (const over of [{ leverage: 0.5 }, { margin: 0 }, { margin: -5 }, { margin: Number.NaN }])
      expect(open(book, over)).toMatchObject({ ok: false, refusal: { code: 'bad_request' } });
  });
});

describe("the perp's other starting rules", () => {
  it('fills an order only at a price published after it was placed', () => {
    const book = freshBook();
    expect(open(book, { placedTime: book.priceTime })).toMatchObject({
      ok: false,
      refusal: { code: 'not_next_price' },
    });
    expect(open(book, { placedTime: book.priceTime - 1 }).ok).toBe(true);
  });

  it('has an off switch: closing-only stops opens, halted stops closes too', () => {
    const book = mustOpen(freshBook()).book;
    const tryOpen = (tradingMode: 'enabled' | 'reduce-only' | 'halted') =>
      openPerpPosition({
        book,
        settings: PERP_SETTINGS,
        tradingMode,
        request: order(book, { userId: 'ben' }),
        balance: 1_000,
        now: book.priceTime,
      });
    const tryClose = (tradingMode: 'enabled' | 'reduce-only' | 'halted') =>
      closePerpPosition({
        book,
        settings: PERP_SETTINGS,
        tradingMode,
        request: { userId: 'ana', direction: 'long', fraction: 1, placedTime: book.priceTime - 1 },
        now: book.priceTime,
      });
    expect(tryOpen('reduce-only')).toMatchObject({ ok: false, refusal: { code: 'trading_off' } });
    expect(tryOpen('halted')).toMatchObject({ ok: false, refusal: { code: 'trading_off' } });
    expect(tryClose('reduce-only').ok).toBe(true);
    expect(tryClose('halted')).toMatchObject({ ok: false, refusal: { code: 'trading_off' } });
  });

  it('pauses trading when the price is more than 2 minutes old', () => {
    const book = freshBook();
    const stale = openPerpPosition({
      book,
      settings: PERP_SETTINGS,
      tradingMode: 'enabled',
      request: order(book),
      balance: 1_000,
      now: book.priceTime + 2 * MINUTE_MS + 1,
    });
    expect(stale).toMatchObject({ ok: false, refusal: { code: 'stale_price' } });
  });

  it('funds once a full hour has passed since the perp opened, then hourly', () => {
    let book = mustOpen(freshBook()).book;
    book = mustOpen(book, { userId: 'ben', direction: 'short', margin: 20 }).book;
    const at = (ms: number) => {
      const p = standInPrice(SEED, START + ms);
      book = applyPerpPrice({ book, price: p.price, priceTime: p.ts }).book;
      return applyPerpFunding({ book, settings: PERP_SETTINGS, now: p.ts });
    };
    expect(at(59 * MINUTE_MS)).toEqual({ ok: false, reason: 'not_due' });
    const first = at(HOUR_MS + 5_000);
    expect(first.ok).toBe(true);
    if (first.ok) {
      // Longs are crowded (500 against 100 of size), so longs pay: a positive rate.
      expect(first.fundingRate).toBeGreaterThan(0);
      expect(first.fundingRate).toBeLessThanOrEqual(PERP_SETTINGS.maxFundingRate);
      book = first.book;
    }
    expect(at(HOUR_MS + 10 * MINUTE_MS)).toEqual({ ok: false, reason: 'not_due' });
    expect(at(2 * HOUR_MS + 5_000).ok).toBe(true);
  });
});

describe('a price the book cannot take', () => {
  // The long pool holds Ṁ50 against a long's Ṁ100 of margin, and the short pool nothing to cover
  // it: a book no price can make solvent, as after Manifold's incidents of August 2026.
  const brokenBook = (): PerpBook => {
    const book = freshBook();
    return {
      ...book,
      state: {
        pool: { L: 50, S: 0 },
        positions: [
          {
            userId: 'ana',
            contractId: 'perp-btc',
            direction: 'long',
            size: 200,
            costBasis: 100,
            originalCostBasis: 100,
            takerFeeCostBasis: 0,
            entryPrice: book.price,
            leverage: 2,
            liquidationPrice: book.price / 2,
            openedTime: book.priceTime,
            updatedTime: book.priceTime,
          },
        ],
      },
    };
  };

  it('moves the price on, keeps the pools and positions, and pauses trading', () => {
    const book = brokenBook();
    const next = applyPerpPrice({
      book,
      price: book.price * 1.01,
      priceTime: book.priceTime + 5_000,
    });
    expect(next.book.halt).toEqual(expect.stringMatching(/./)); // Manifold's own reason
    expect(next.book.price).toBe(book.price * 1.01);
    expect(next.book.state).toEqual(book.state);
    expect(next.moves).toEqual([]);
    const tryClose = closePerpPosition({
      book: next.book,
      settings: PERP_SETTINGS,
      tradingMode: 'enabled',
      request: { userId: 'ana', direction: 'long', fraction: 1, placedTime: book.priceTime },
      now: next.book.priceTime,
    });
    expect(tryClose).toMatchObject({ ok: false, refusal: { code: 'paused' } });
    expect(open(next.book, { userId: 'ben' })).toMatchObject({
      ok: false,
      refusal: { code: 'paused' },
    });
    expect(
      applyPerpFunding({
        book: next.book,
        settings: PERP_SETTINGS,
        now: next.book.priceTime + 2 * HOUR_MS,
      }),
    ).toEqual({ ok: false, reason: 'paused' });
  });

  it('resumes trading with the first price that applies cleanly', () => {
    const book = { ...mustOpen(freshBook()).book, halt: 'an earlier price could not apply' };
    const next = applyPerpPrice({ book, price: book.price, priceTime: book.priceTime + 5_000 });
    expect(next.book.halt).toBeNull();
    expect(open(next.book, { userId: 'ben' }).ok).toBe(true);
  });
});

describe('a part-close and a flip', () => {
  it('refuses a part-close sized against a position that has since changed', () => {
    const book = mustOpen(freshBook()).book;
    const close = (expectedSize: number) =>
      closePerpPosition({
        book,
        settings: PERP_SETTINGS,
        tradingMode: 'enabled',
        request: {
          userId: 'ana',
          direction: 'long',
          fraction: 0.5,
          expectedSize,
          placedTime: book.priceTime - 1,
        },
        now: book.priceTime,
      });
    expect(close(400)).toMatchObject({ ok: false, refusal: { code: 'position_changed' } });
    expect(close(500).ok).toBe(true);
  });

  it('closes the other side and opens this one in one step', () => {
    const book = mustOpen(freshBook(), { margin: 100, leverage: 5 }).book;
    const flipped = mustOpen(book, { direction: 'short', margin: 50, leverage: 2 });
    expect(flipped.closePayout).toBeCloseTo(100, 9); // the same price: the margin back
    expect(flipped.moves.map((m) => m.kind)).toEqual(['payout', 'margin', 'fee']);
    expect(flipped.book.state.positions.map((p) => [p.userId, p.direction])).toEqual([
      ['ana', 'short'],
    ]);
  });
});

describe('the stand-in price', () => {
  const moment = START + 123_456;

  it('is the same for the same seed and moment, and differs between seeds', () => {
    expect(standInPrice(SEED, moment)).toEqual(standInPrice(SEED, moment));
    expect(standInPrice(SEED, moment).price).not.toBe(
      standInPrice('00000000000000a2', moment).price,
    );
    // Pure: asking for a far moment first changes nothing about a near one.
    const near = standInPrice(SEED, START);
    standInPrice(SEED, START + 400 * 24 * HOUR_MS);
    expect(standInPrice(SEED, START)).toEqual(near);
  });

  it('is fixed: a known seed and moment always give this price', () => {
    expect(standInPrice('0000000000000001', STAND_IN_PRICE.origin)).toEqual({
      ts: STAND_IN_PRICE.origin,
      price: 100_000,
    });
    expect(standInPrice('0000000000000001', STAND_IN_PRICE.origin + 7 * 24 * HOUR_MS).price).toBe(
      104_744.65,
    );
    expect(standInPrice('0000000000000002', STAND_IN_PRICE.origin + 365 * 24 * HOUR_MS).price).toBe(
      84_954.55,
    );
  });

  it('gives a new price every 5 seconds, the same one within each 5 seconds', () => {
    const step = standInPrice(SEED, moment);
    expect(step.ts % STAND_IN_PRICE.intervalMs).toBe(STAND_IN_PRICE.origin % 5_000);
    expect(moment - step.ts).toBeGreaterThanOrEqual(0);
    expect(moment - step.ts).toBeLessThan(5_000);
    expect(standInPrice(SEED, step.ts + 4_999)).toEqual(step);
    let changes = 0;
    for (let i = 1; i <= 200; i++) {
      const next = standInPrice(SEED, step.ts + i * 5_000);
      expect(next.ts).toBe(step.ts + i * 5_000);
      if (next.price !== standInPrice(SEED, step.ts + (i - 1) * 5_000).price) changes++;
    }
    expect(changes).toBeGreaterThan(190);
  });

  it('moves the way Bitcoin does: about 55% a year, enough to liquidate 10 times leverage', () => {
    // A day of 5-second prices for the step-to-step spread, four weeks of hourly ones for the
    // rest: the same statistics from 17,952 prices instead of 483,840, so the test stays light
    // beside the rest of the suite.
    const sd = (xs: number[]) => {
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
    };
    const changes = (every: number, count: number) => {
      const prices = Array.from(
        { length: count + 1 },
        (_, i) => standInPrice(SEED, START + i * every).price,
      );
      return {
        prices,
        logs: prices.slice(1).map((p, i) => Math.log(p / (prices[i] as number))),
      };
    };
    const perStep = changes(5_000, 17_280).logs;
    const { prices, logs: hourly } = changes(HOUR_MS, 4 * 7 * 24);
    expect(sd(perStep) * Math.sqrt(365 * 17_280)).toBeGreaterThan(0.45);
    expect(sd(perStep) * Math.sqrt(365 * 17_280)).toBeLessThan(0.65);
    expect(sd(hourly) * Math.sqrt(365 * 24)).toBeGreaterThan(0.4);
    expect(sd(hourly) * Math.sqrt(365 * 24)).toBeLessThan(0.7);
    // Somewhere in four weeks, a 10% move against one side: what liquidates 10 times leverage.
    let peak = prices[0] as number;
    let trough = prices[0] as number;
    let swing = 0;
    for (const p of prices) {
      peak = Math.max(peak, p);
      trough = Math.min(trough, p);
      swing = Math.max(swing, 1 - p / peak, p / trough - 1);
    }
    expect(swing).toBeGreaterThan(0.1);
  });

  it('is a keyed hash of a secret seed: the reference test vector, and nothing without the key', () => {
    // HalfSipHash-2-4's reference vector: key bytes 00 to 07, empty message, gives a9 35 9f 5b.
    expect(halfSipHash([0x03020100, 0x07060504], [])).toBe(0x5b9f35a9);
    // Seeds one bit apart give unrelated walks.
    const a = standInPrice('0000000000000000', START + 7 * 24 * HOUR_MS).price;
    const b = standInPrice('0000000000000001', START + 7 * 24 * HOUR_MS).price;
    expect(Math.abs(Math.log(a / b))).toBeGreaterThan(0.001);
  });

  it('starts on 1 January 2026 and needs a seed of 16 hexadecimal digits', () => {
    expect(() => standInPrice(SEED.toUpperCase(), START)).toThrow();
    expect(() => standInPrice('0000000000000001', STAND_IN_PRICE.origin - 1)).toThrow();
    expect(() => standInPrice('a1', START)).toThrow();
  });
});
