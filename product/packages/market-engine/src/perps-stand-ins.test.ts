import { describe, expect, it } from 'vitest';
import { ADJACENT_MSRY_FEED_ID } from './manifold/perps/adjacent-msry.ts';
import type { OraclePoint } from './manifold/perps/oracle.ts';
import { isEligiblePerpTick, isProviderStampedFeed } from './manifold/perps/orders.ts';

// Our two slim files stand in for Manifold's price-feed files that `orders.ts` imports
// (README, "Ours, in place of Manifold's (perps)"). The compare script can't check them against
// Manifold's, so this does: the same values, and the rule `orders.ts` builds on them.
describe("the perps maths' stand-ins for Manifold's price-feed files", () => {
  it("name Adjacent's feed as Manifold does, which orders.ts counts as provider-stamped", () => {
    expect(ADJACENT_MSRY_FEED_ID).toBe('adjacent-msry');
    expect(isProviderStampedFeed(ADJACENT_MSRY_FEED_ID)).toBe(true);
  });

  it('give orders.ts the price point it reads: an order fills only at a later price', () => {
    const point: OraclePoint = { ts: 5_000, price: 100_000 };
    expect(isEligiblePerpTick('btc-usd', 4_999, point)).toBe(true);
    expect(isEligiblePerpTick('btc-usd', 5_000, point)).toBe(false);
  });
});
