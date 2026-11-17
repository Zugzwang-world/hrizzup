import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids.ts';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('makes a version 7 UUID in lower case, with the RFC 9562 variant', () => {
    for (let i = 0; i < 1_000; i++) expect(uuidv7()).toMatch(V7);
  });

  it('starts with the time in milliseconds, 48 bits of it', () => {
    const at = Date.UTC(2026, 10, 17, 10, 0, 0, 123);
    const id = uuidv7({ now: () => at });
    const prefix = id.slice(0, 13).replace('-', '');
    expect(Number.parseInt(prefix, 16)).toBe(at);
    // The largest time there is, and the smallest.
    expect(uuidv7({ now: () => 2 ** 48 - 1 }).startsWith('ffffffff-ffff-7')).toBe(true);
    expect(uuidv7({ now: () => 0 }).startsWith('00000000-0000-7')).toBe(true);
  });

  it('refuses a time that is not 48 bits of whole milliseconds', () => {
    expect(() => uuidv7({ now: () => -1 })).toThrow(RangeError);
    expect(() => uuidv7({ now: () => 2 ** 48 })).toThrow(RangeError);
    expect(() => uuidv7({ now: () => 1.5 })).toThrow(RangeError);
    expect(() => uuidv7({ now: () => Number.NaN })).toThrow(RangeError);
  });

  it('keeps the version and the variant whatever the random bits are', () => {
    for (const fill of [0x00, 0xff]) {
      const id = uuidv7({ random: (bytes) => bytes.fill(fill) });
      expect(id).toMatch(V7);
    }
  });

  it('sorts by the time it was made, with a controlled clock', () => {
    const times = [1_000, 1_001, 65_536, 4_294_967_296, 1_800_000_000_000];
    const ids = times.map((time) => uuidv7({ now: () => time }));
    expect([...ids].sort()).toEqual(ids);
  });

  it('never repeats in 100,000', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(100_000);
  });
});
