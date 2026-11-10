// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/** The most leverage a position may have: the founder's cap (PLAN.md, "Starting rules"). */
export declare const PERP_LEVERAGE_CAP = 10;
export type PerpSettings = {
    /** The most leverage an open may ask for: at least 1, never above `PERP_LEVERAGE_CAP`. */
    maxLeverage: number;
    /** The opening fee, in basis points of the position's size (closing is free). */
    takerFeeBps: number;
    /** The fee's extra for positions large beside the pool (0: off, the flat fee only). */
    takerFeeImpact: number;
    /** Time between funding payments. */
    fundingPeriodMs: number;
    /** How fast funding grows with the imbalance between the two sides (Manifold's `k`). */
    fundingSensitivity: number;
    /** The most funding can move in one period, as a share of the paying side (`f_max`). */
    maxFundingRate: number;
    /** How old the price may be before trading pauses until the next one. */
    maxPriceAgeMs: number;
    /** What the house puts into each side's pool when the perp opens. */
    subsidyLong: number;
    subsidyShort: number;
};
export declare const PERP_SETTINGS: PerpSettings;
/**
 * Refuses settings the engine must never run on: leverage outside 1 to the cap, and the funding
 * and fee bounds Manifold's own engine enforces (`assertPerpFundingConfig`,
 * `assertPerpTakerFeeConfig`).
 */
export declare const assertPerpSettings: (settings: PerpSettings) => void;
