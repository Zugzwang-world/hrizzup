import { describe, expect, it } from 'vitest';
import { YEAR_MS } from '../manifold/util/time.ts';
import { STAND_IN_PRICE, standInPrice } from './stand-in-price.ts';

/**
 * A walk of its own (R5): a check run's test perp walks from its own start, at its own price, as
 * fast as it says, while the Bitcoin perp's prices stay exactly R3's.
 */
const SEED = '00112233aabbccdd';

describe("a test perp's own walk", () => {
  it("leaves the Bitcoin perp's prices exactly as they were", () => {
    const moment = Date.UTC(2026, 10, 10, 12, 0, 3);
    expect(
      standInPrice(SEED, moment, {
        origin: STAND_IN_PRICE.origin,
        startPrice: STAND_IN_PRICE.startPrice,
        annualVolatility: STAND_IN_PRICE.annualVolatility,
      }),
    ).toEqual(standInPrice(SEED, moment));
  });

  it('starts at its own origin and price, its 5-second steps counted from there', () => {
    const origin = Date.UTC(2026, 10, 10, 9, 30, 0, 123);
    const walk = { origin, startPrice: 100, annualVolatility: 40 };
    expect(standInPrice(SEED, origin, walk)).toEqual({ ts: origin, price: 100 });
    expect(standInPrice(SEED, origin + 4_999, walk).ts).toBe(origin);
    expect(standInPrice(SEED, origin + 5_000, walk).ts).toBe(origin + 5_000);
    expect(() => standInPrice(SEED, origin - 1, walk)).toThrow('origin');
    expect(() => standInPrice(SEED, origin, { ...walk, startPrice: 0 })).toThrow();
  });

  it('moves as fast as it says: a 4,000% walk moves far more in an hour than Bitcoin does', () => {
    const origin = Date.UTC(2026, 10, 10);
    const moves = (annualVolatility: number) => {
      const walk = { origin, startPrice: 100, annualVolatility };
      let total = 0;
      for (let step = 1; step <= 720; step++) {
        const before = standInPrice(SEED, origin + (step - 1) * 5_000, walk).price;
        const after = standInPrice(SEED, origin + step * 5_000, walk).price;
        total += Math.abs(Math.log(after / before));
      }
      return total / 720;
    };
    // A step's typical move is the volatility times the square root of 5 seconds in years.
    const expected = (v: number) => v * Math.sqrt(5_000 / YEAR_MS) * Math.sqrt(2 / Math.PI);
    expect(moves(40)).toBeGreaterThan(expected(40) * 0.8);
    expect(moves(40)).toBeLessThan(expected(40) * 1.2);
    expect(moves(40)).toBeGreaterThan(50 * moves(0.55));
  });
});
