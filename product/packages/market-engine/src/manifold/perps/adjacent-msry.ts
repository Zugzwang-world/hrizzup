// Ours, in place of Manifold's `common/src/perps/adjacent-msry.ts` (README, "Ours, in place of
// Manifold's"). Manifold's file reads Adjacent Markets' misery index, one of Manifold's own
// price feeds, which Hrizzup doesn't have. The perps maths imports only this feed's name from
// it (`orders.ts` lists it among the feeds whose provider stamps each price), so that is all
// this file holds, with Manifold's value.

export const ADJACENT_MSRY_FEED_ID = 'adjacent-msry';
