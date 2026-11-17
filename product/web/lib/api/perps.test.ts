import { afterEach, describe, expect, it, vi } from 'vitest';
import { perpSource } from './perps.ts';

/**
 * Where the website's perp calls get a price besides each perp's own record (perps.ts): no seed
 * from the environment, which was retired in Round 6 (R4). The listed perp reads our own stored
 * price and a check run's test perp brings its own seed, so nothing here reads the environment.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the perps' price source", () => {
  it('gives no seed, and ignores the environment even where one is set', () => {
    expect(perpSource()).toEqual({ seed: undefined });
    vi.stubEnv('PERP_STAND_IN_SEED', '0123456789abcdef');
    expect(perpSource()).toEqual({ seed: undefined });
    expect(perpSource().seed).toBeUndefined();
  });
});
