import { describe, expect, it } from 'vitest';
import { nextFundingAt } from './plan.ts';
import { plain } from './trading.ts';

/**
 * Quick checks of the calls' own helpers: the maths' numbers written as the contract takes them
 * (plain decimal text, never JavaScript's exponent form), and when funding next falls due, by the
 * same rule as the database's perps.next_funding_at (its tests in
 * infra/supabase/tests/perp_book_rules.test.sql use the same cases).
 */

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

describe('a number as the contract writes it', () => {
  it('is plain decimal text, every digit kept, whatever JavaScript would write', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [-0, '0'],
      [123.45, '123.45'],
      [100000.12, '100000.12'],
      [5.707762557077626e-7, '0.0000005707762557077626'],
      [-3.2e-8, '-0.000000032'],
      [1e-7, '0.0000001'],
      [1.5e21, '1500000000000000000000'],
      [0.00011415525114155251, '0.00011415525114155251'],
    ];
    for (const [value, text] of cases) {
      expect(plain(value), String(value)).toBe(text);
      expect(plain(value), String(value)).toMatch(DECIMAL);
      expect(Number(plain(value))).toBe(value === 0 ? 0 : value);
    }
    expect(() => plain(Number.NaN)).toThrow();
    expect(() => plain(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('when funding next falls due', () => {
  const hour = 3_600_000;
  const minute = 60_000;
  const from = Date.UTC(2026, 10, 10, 9, 0, 0);
  const nextAfter = (ms: number) => nextFundingAt(from, from + ms, hour) - from;

  it('is on the perp’s own hourly slots, never sooner than the engine takes a run', () => {
    expect(nextFundingAt(from, null, hour) - from).toBe(hour);
    expect(nextAfter(hour + 30_000)).toBe(2 * hour);
    expect(nextAfter(hour + 5 * minute)).toBe(2 * hour + 4 * minute);
    expect(nextAfter(2 * hour + 4 * minute)).toBe(3 * hour + 3 * minute);
    expect(nextAfter(3 * hour + 59_000)).toBe(4 * hour);
    expect(nextAfter(7 * hour + 10 * minute)).toBe(8 * hour + 9 * minute);
  });
});
