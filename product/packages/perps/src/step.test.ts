import { describe, expect, it } from 'vitest';
import { PerpNotSetUpError, type PerpPriceSource, priceFor, priceSource } from './step.ts';

/**
 * Where a stand-in perp's seed comes from, with no database (PLAN.md step 3.4a): its own, or a
 * fallback seed in the price source, which no environment holds since Round 6 (R4). A seed that
 * isn't 16 lowercase hexadecimal digits counts as none, and a stand-in perp with no seed at all
 * answers "not set up", never a guessed price.
 */

const SEED = '0123456789abcdef';
const OTHER_SEED = 'fedcba9876543210';
const T = Date.parse('2026-11-11T09:00:00.000Z');

const standIn: PerpPriceSource = {
  seed: null,
  standIn: { origin: '2026-11-11T08:00:00Z', startPrice: '100', volatility: '40' },
};

describe('a fallback seed as a price source', () => {
  it('counts anything but 16 lowercase hexadecimal digits as none', () => {
    for (const bad of [undefined, '', '   ', 'not-a-seed', '0123456789ABCDEF', '0123456789abcde']) {
      expect(priceSource(bad), String(bad)).toEqual({ seed: undefined });
    }
  });

  it('passes a proper seed through, trimmed', () => {
    expect(priceSource(SEED)).toEqual({ seed: SEED });
    expect(priceSource(` ${SEED}\n`)).toEqual({ seed: SEED });
  });
});

describe("a stand-in perp's price", () => {
  it('is not set up without a seed of its own or a fallback one', () => {
    expect(() => priceFor(standIn, { seed: undefined })).toThrow(PerpNotSetUpError);
    expect(() => priceFor(standIn, priceSource('not-a-seed'))).toThrow(PerpNotSetUpError);
  });

  it("comes from the perp's own seed, which a fallback never overrides", () => {
    const own = priceFor({ ...standIn, seed: SEED }, { seed: undefined })(T);
    expect(own.price).toBeGreaterThan(0);
    expect(priceFor({ ...standIn, seed: SEED }, { seed: OTHER_SEED })(T)).toEqual(own);
    // The two seeds give different prices at T, so the test above can tell which one was used.
    expect(priceFor({ ...standIn, seed: OTHER_SEED }, { seed: undefined })(T)).not.toEqual(own);
  });

  it("falls back to the source's seed when the perp has none of its own", () => {
    const fallback = priceFor(standIn, { seed: SEED })(T);
    expect(fallback).toEqual(priceFor({ ...standIn, seed: SEED }, { seed: undefined })(T));
  });
});
