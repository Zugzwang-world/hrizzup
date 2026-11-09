import { describe, expect, it } from 'vitest';
import { decimal, down, fromNumber, LARGEST, micros, min, split, toNumber, up } from './decimal.ts';

describe('exact amounts', () => {
  it('reads decimal text exactly, to six places', () => {
    expect(micros('12.5')).toBe(12_500_000n);
    expect(micros('0.000001')).toBe(1n);
    expect(micros('-3')).toBe(-3_000_000n);
    expect(micros(' 1000.000000 ')).toBe(1_000_000_000n);
    expect(micros('123456789.123456')).toBe(123_456_789_123_456n);
  });

  it('refuses anything that is not an amount with at most six places', () => {
    for (const bad of ['', '1.0000001', '1e3', '0x10', 'NaN', '1,000', '.5', '1.', '--1']) {
      expect(() => micros(bad), bad).toThrow(RangeError);
    }
  });

  it('writes amounts as the database keeps them', () => {
    expect(decimal(12_500_000n)).toBe('12.500000');
    expect(decimal(1n)).toBe('0.000001');
    expect(decimal(-1n)).toBe('-0.000001');
    expect(decimal(0n)).toBe('0.000000');
    expect(decimal(micros('987654.321'))).toBe('987654.321000');
  });

  it('hands the maths a floating-point number, refusing what it could not hold exactly', () => {
    expect(toNumber(12_500_000n)).toBe(12.5);
    expect(toNumber(LARGEST)).toBe(Number.MAX_SAFE_INTEGER / 1e6);
    expect(() => toNumber(LARGEST + 1n)).toThrow(RangeError);
  });

  it("rounds the maths' results once, to the nearest millionth, halves away from zero", () => {
    expect(fromNumber(190.90909090909)).toBe(190_909_091n);
    expect(fromNumber(-190.90909090909)).toBe(-190_909_091n);
    expect(fromNumber(0.0000005)).toBe(1n);
    expect(fromNumber(-0.0000005)).toBe(-1n);
    expect(fromNumber(99.99999999999997)).toBe(100_000_000n);
    expect(() => fromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => fromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('finds the smaller of two amounts', () => {
    expect(min(2n, 3n)).toBe(2n);
    expect(min(-2n, -3n)).toBe(-3n);
  });
});

describe("rounding in the house's favour", () => {
  it('rounds what a person receives down, and what a resting order pays up', () => {
    expect(down(190.90909090909)).toBe(190_909_090n);
    expect(up(190.90909090909)).toBe(190_909_091n);
    expect(down(-4.5336579)).toBe(-4_533_657n); // Toward zero: less money back
    expect(up(-4.5336571)).toBe(-4_533_658n);
  });

  it("doesn't let floating point's own noise cost a millionth, at any size", () => {
    expect(down(99.99999999999997)).toBe(100_000_000n);
    expect(up(100.00000000000003)).toBe(100_000_000n);
    expect(down(0.1 + 0.2)).toBe(300_000n);
    // Large amounts: a double's last digit is coarser here, so its noise is too.
    const large = 123456.789012;
    expect(down(large - 2e-11)).toBe(123_456_789_012n);
    expect(up(large + 2e-11)).toBe(123_456_789_012n);
    // But a real fraction of a millionth still rounds the house's way.
    expect(down(large + 4e-7)).toBe(123_456_789_012n);
    expect(up(large + 4e-7)).toBe(123_456_789_013n);
  });

  it('refuses what the maths should never give', () => {
    expect(() => down(Number.NaN)).toThrow(RangeError);
    expect(() => up(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('splitting a rounded total across its parts', () => {
  it('adds up exactly, each part within a millionth of its own rounding', () => {
    const parts = [33.3333333, 33.3333333, 33.3333334];
    const out = split(100_000_000n, parts);
    expect(out.reduce((a, b) => a + b, 0n)).toBe(100_000_000n);
    for (const [i, part] of out.entries()) {
      expect(Number(part) / 1e6 - (parts[i] as number)).toBeLessThan(1e-6);
    }
  });

  it('gives the missing millionths to the parts that lost the most', () => {
    expect(split(3n, [0.0000009, 0.0000009, 0.0000012])).toEqual([1n, 1n, 1n]);
    expect(split(2n, [0.0000004, 0.0000009, 0.0000007])).toEqual([0n, 1n, 1n]);
  });

  it('keeps the sign of a negative total (money coming back)', () => {
    const out = split(-50_000_000n, [-20.0000004, -29.9999996]);
    expect(out).toEqual([-20_000_000n, -30_000_000n]);
  });

  it('takes back a millionth when the parts come to a little more than the total', () => {
    const out = split(99_999_999n, [50.0000004, 50.0000004]);
    expect(out.reduce((a, b) => a + b, 0n)).toBe(99_999_999n);
    expect(out.every((part) => part >= 49_999_999n && part <= 50_000_000n)).toBe(true);
  });

  it('splits nothing into nothing, and refuses a total with nowhere to go', () => {
    expect(split(0n, [])).toEqual([]);
    expect(() => split(1n, [])).toThrow(RangeError);
  });

  it('holds over many random splits', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 1000; run++) {
      const parts = Array.from({ length: 1 + Math.floor(random() * 8) }, () => random() * 300);
      const total = fromNumber(parts.reduce((a, b) => a + b, 0));
      const out = split(total, parts);
      expect(out.reduce((a, b) => a + b, 0n)).toBe(total);
      for (const [i, part] of out.entries()) {
        expect(Math.abs(Number(part) / 1e6 - (parts[i] as number))).toBeLessThan(2e-6);
      }
    }
  });
});
