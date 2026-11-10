import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUR_MS } from '../manifold/util/time.ts';
import {
  applyPerpFunding,
  applyPerpPrice,
  closePerpPosition,
  newPerpBook,
  openPerpPosition,
  type PerpBook,
} from './engine.ts';
import { PERP_SETTINGS, type PerpSettings } from './settings.ts';
import { STAND_IN_PRICE } from './stand-in-price.ts';
import { TestLedger } from './test-ledger.ts';

// Our money tests (README, "Our money tests: the perp"): no play money is created or lost when a
// position opens, closes at a profit or at a loss, pays or receives funding, is liquidated, or is
// scaled down because the pool ran short, and the 10 times cap refuses more. A small ledger
// (`test-ledger.ts`) applies each step's moves and checks after every one. The clock throws.
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('the perps maths read the clock');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A perp at a set price, two traders with Ṁ1,000 each, and the ledger checking every step. */
const world = (settings: PerpSettings = PERP_SETTINGS, price = 100_000) => {
  const t0 = STAND_IN_PRICE.origin + 3_600_000;
  let book: PerpBook = newPerpBook({
    contractId: 'perp-btc',
    feedId: STAND_IN_PRICE.feedId,
    settings,
    price,
    priceTime: t0,
    now: t0,
  });
  const ledger = new TestLedger(
    { ana: 1_000, ben: 1_000 },
    settings.subsidyLong + settings.subsidyShort,
  );
  ledger.check(book, 'opened');
  const w = {
    ledger,
    get book() {
      return book;
    },
    /** Places an order just before the current price, so it fills at it. */
    open(userId: string, direction: 'long' | 'short', margin: number, leverage: number) {
      const result = openPerpPosition({
        book,
        settings,
        tradingMode: 'enabled',
        request: { userId, direction, margin, leverage, placedTime: book.priceTime - 1 },
        balance: ledger.balance(userId),
        now: book.priceTime,
      });
      if (result.ok) {
        book = result.book;
        ledger.apply(result.moves);
      }
      ledger.check(book, `open ${userId}`);
      return result;
    },
    close(userId: string, direction: 'long' | 'short', fraction = 1) {
      const position = book.state.positions.find(
        (p) => p.userId === userId && p.direction === direction,
      );
      const result = closePerpPosition({
        book,
        settings,
        tradingMode: 'enabled',
        request: {
          userId,
          direction,
          fraction,
          expectedSize: position?.size,
          placedTime: book.priceTime - 1,
        },
        now: book.priceTime,
      });
      if (!result.ok) throw new Error(`close refused: ${result.refusal.message}`);
      book = result.book;
      ledger.apply(result.moves);
      ledger.check(book, `close ${userId}`);
      return result;
    },
    /** A new price, 5 seconds after the last. */
    price(next: number) {
      const result = applyPerpPrice({ book, price: next, priceTime: book.priceTime + 5_000 });
      book = result.book;
      ledger.apply(result.moves);
      ledger.check(book, `price ${next}`);
      return result;
    },
    /** The same price again, an hour on, then funding. */
    hourLater() {
      const later = applyPerpPrice({
        book,
        price: book.price,
        priceTime: book.priceTime + HOUR_MS,
      });
      book = later.book;
      ledger.apply(later.moves);
      const funded = applyPerpFunding({ book, settings, now: book.priceTime });
      if (funded.ok) {
        book = funded.book;
        ledger.apply(funded.moves);
      }
      ledger.check(book, 'funding');
      return funded;
    },
  };
  return w;
};

const position = (book: PerpBook, userId: string) =>
  book.state.positions.find((p) => p.userId === userId);

describe('opening', () => {
  it('moves the margin and the 0.1% fee into the trader’s own pool, and nothing else', () => {
    const w = world();
    const opened = w.open('ana', 'long', 100, 5);
    expect(opened.ok).toBe(true);
    expect(w.ledger.balance('ana')).toBeCloseTo(1_000 - 100 - 0.5, 12); // fee: 0.1% of 500
    expect(w.book.state.pool).toEqual({ L: 25_000 + 100.5, S: 25_000 });
    expect(position(w.book, 'ana')).toMatchObject({ size: 500, costBasis: 100, leverage: 5 });
  });
});

describe('closing', () => {
  it('at a profit: the margin back from its own pool, the profit from the other side’s', () => {
    const w = world();
    w.open('ana', 'long', 100, 5);
    w.price(105_000); // +5% on 500 of size: a profit of 25
    const closed = w.close('ana', 'long');
    expect(closed.payout).toBeCloseTo(125, 9);
    expect(w.ledger.balance('ana')).toBeCloseTo(1_000 - 0.5 + 25, 9);
    expect(w.book.state.pool.L).toBeCloseTo(25_000 + 0.5, 9); // the fee stays
    expect(w.book.state.pool.S).toBeCloseTo(25_000 - 25, 9);
  });

  it('at a loss: what is left of the margin, all from its own pool', () => {
    const w = world();
    w.open('ben', 'short', 100, 5);
    w.price(104_000); // +4% against a short of 500: a loss of 20
    const closed = w.close('ben', 'short');
    expect(closed.payout).toBeCloseTo(80, 9);
    expect(w.ledger.balance('ben')).toBeCloseTo(1_000 - 0.5 - 20, 9);
    expect(w.book.state.pool).toEqual({ L: 25_000, S: expect.closeTo(25_000 + 20.5, 9) });
  });

  it('in parts pays the same as all at once', () => {
    const whole = world();
    whole.open('ana', 'long', 200, 4);
    whole.price(103_000);
    const once = whole.close('ana', 'long').payout;

    const parts = world();
    parts.open('ana', 'long', 200, 4);
    parts.price(103_000);
    const first = parts.close('ana', 'long', 0.25);
    expect(first.fraction).toBe(0.25);
    const rest = parts.close('ana', 'long');
    expect(first.payout + rest.payout).toBeCloseTo(once, 9);
    expect(parts.ledger.balance('ana')).toBeCloseTo(whole.ledger.balance('ana'), 9);
  });

  it('a flip closes one side and opens the other in one step, the payout paying for it', () => {
    const w = world();
    w.open('ana', 'long', 900, 2);
    w.price(101_000); // +1% on 1,800: a profit of 18
    const flipped = w.open('ana', 'short', 950, 2);
    expect(flipped.ok).toBe(true);
    if (!flipped.ok) return;
    expect(flipped.closePayout).toBeCloseTo(918, 9);
    expect(flipped.moves.map((m) => m.kind)).toEqual(['payout', 'margin', 'fee']);
    expect(w.book.state.positions.map((p) => p.direction)).toEqual(['short']);
  });
});

describe('hourly funding', () => {
  it('moves value from the crowded side to the other, inside the pools, creating nothing', () => {
    const w = world();
    w.open('ana', 'long', 100, 5); // 500 of size long
    w.open('ben', 'short', 50, 2); // 100 short: longs are crowded
    const escrowBefore = w.ledger.escrow;
    const funded = w.hourLater();
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;
    const f = PERP_SETTINGS.maxFundingRate * (4 / 5); // I(5) = (5 − 1)/(5 − 1 + 1)
    expect(funded.fundingRate).toBeCloseTo(f, 15);
    expect(funded.moves).toEqual([]);
    expect(w.ledger.escrow).toBe(escrowBefore);
    // Longs (and their pool) shrink by f; the short side gains what they lose.
    expect(position(w.book, 'ana')?.costBasis).toBeCloseTo(100 * (1 - f), 12);
    expect(position(w.book, 'ben')?.costBasis).toBeGreaterThan(50);
    const anaOut = w.close('ana', 'long').payout;
    const benOut = w.close('ben', 'short').payout;
    expect(anaOut).toBeCloseTo(100 * (1 - f), 9);
    expect(benOut).toBeGreaterThan(50);
  });

  it('runs every hour while the imbalance lasts, and the money still adds up', () => {
    const w = world();
    w.open('ana', 'short', 300, 5);
    w.open('ben', 'long', 100, 3);
    for (let hour = 0; hour < 48; hour++) {
      const funded = w.hourLater();
      expect(funded.ok, `hour ${hour}`).toBe(true);
      if (funded.ok) expect(funded.fundingRate).toBeLessThan(0); // shorts crowded: shorts pay
    }
    w.close('ana', 'short');
    w.close('ben', 'long');
    expect(w.book.state.positions).toEqual([]);
  });
});

describe('liquidation', () => {
  it('closes a 10-times long when the price falls 10%, keeping its margin in the pool', () => {
    const w = world();
    w.open('ana', 'long', 100, 10); // liquidated at 90,000
    const anaAfterOpen = w.ledger.balance('ana');
    expect(w.price(90_001).liquidated).toEqual([]);
    const result = w.price(89_990);
    expect(result.liquidated.map((p) => p.userId)).toEqual(['ana']);
    expect(result.moves).toEqual([]);
    expect(w.ledger.balance('ana')).toBe(anaAfterOpen);
    expect(w.book.state.positions).toEqual([]);
    expect(w.book.state.pool.L).toBeCloseTo(25_000 + 101, 9); // margin and fee stay
  });

  it('leaves the lost margin to pay the other side’s winners', () => {
    const w = world();
    w.open('ana', 'long', 100, 10);
    w.open('ben', 'short', 100, 10);
    w.price(89_000);
    expect(position(w.book, 'ana')).toBeUndefined();
    const won = w.close('ben', 'short').payout; // 11% on 1,000: a profit of 110
    expect(won).toBeCloseTo(210, 9);
  });
});

describe('the pool running short', () => {
  // Small pools, so one winner's profit can outgrow the other side's.
  const thin = { ...PERP_SETTINGS, subsidyLong: 100, subsidyShort: 100 };

  it('scales winners down until the pools can pay them, and pays exactly that', () => {
    const w = world(thin);
    expect(w.open('ana', 'long', 100, 10).ok).toBe(true); // 1,000 of size: the cap's limit
    const tick = w.price(120_000); // +20%: a profit of 200, against Ṁ100 in the short pool
    expect(tick.adlFactorLong).toBeCloseTo(0.5, 12);
    expect(position(w.book, 'ana')?.size).toBeCloseTo(500, 9);
    const closed = w.close('ana', 'long');
    expect(closed.payout).toBeCloseTo(200, 9); // margin 100, scaled profit 100
    expect(w.book.state.pool.S).toBeCloseTo(0, 9);
    expect(w.ledger.balance('ana')).toBeCloseTo(1_000 - 1 + 100, 9);
  });

  it('settles a winner scaled down to nothing: paid their margin, from their own pool', () => {
    // The pattern of Manifold's incidents (August 2026): the short pool holds Ṁ80 against a
    // short's Ṁ100 of margin. At +10% the long's profit has nothing left to come from.
    const price = 100_000;
    const t0 = STAND_IN_PRICE.origin + 3_600_000;
    const row = (userId: string, direction: 'long' | 'short', size: number) => ({
      userId,
      contractId: 'perp-btc',
      direction,
      size,
      costBasis: 100,
      originalCostBasis: 100,
      takerFeeCostBasis: 0,
      entryPrice: price,
      leverage: size / 100,
      liquidationPrice: direction === 'long' ? price * (1 - 100 / size) : price * (1 + 100 / size),
      openedTime: t0,
      updatedTime: t0,
    });
    const book: PerpBook = {
      ...newPerpBook({
        contractId: 'perp-btc',
        feedId: STAND_IN_PRICE.feedId,
        settings: PERP_SETTINGS,
        price,
        priceTime: t0,
        now: t0,
      }),
      state: {
        pool: { L: 200, S: 80 },
        positions: [row('ana', 'long', 1_000), row('ben', 'short', 100)],
      },
    };
    const ledger = new TestLedger({ ana: 0, ben: 0 }, 280);
    // (No check before: this book is short on purpose, and the check would rightly refuse it.)
    const tick = applyPerpPrice({ book, price: price * 1.1, priceTime: t0 + 5_000 });
    expect(tick.book.halt).toBeNull();
    expect(tick.adlFactorLong).toBe(0);
    expect(tick.moves).toEqual([{ userId: 'ana', kind: 'payout', amount: 100 }]);
    ledger.apply(tick.moves);
    ledger.check(tick.book, 'after');
    expect(tick.book.state.positions.map((p) => p.userId)).toEqual(['ben']);
  });

  it('refuses a position the other side couldn’t back', () => {
    const w = world(thin);
    const refused = w.open('ana', 'long', 101, 10);
    expect(refused).toMatchObject({ ok: false, refusal: { code: 'exposure_cap' } });
    expect(w.ledger.balance('ana')).toBe(1_000);
  });
});

describe('the 10 times cap refuses more, and a refusal moves nothing', () => {
  it('refuses 11 times, leaving every balance and pool as it was', () => {
    const w = world();
    const before = { ana: w.ledger.balance('ana'), pool: w.book.state.pool };
    const refused = w.open('ana', 'long', 100, 11);
    expect(refused).toMatchObject({ ok: false, refusal: { code: 'leverage_too_high' } });
    expect(w.ledger.balance('ana')).toBe(before.ana);
    expect(w.book.state.pool).toEqual(before.pool);
    expect(w.ledger.moves).toEqual([]);
    expect(w.open('ana', 'long', 100, 10).ok).toBe(true);
  });

  it('refuses more than the balance can pay, margin and fee together', () => {
    const w = world();
    expect(w.open('ana', 'long', 1_000, 2)).toMatchObject({
      ok: false,
      refusal: { code: 'insufficient_balance' },
    });
    expect(w.open('ana', 'long', 998, 2).ok).toBe(true); // 998 + a fee of 1.996
  });
});
