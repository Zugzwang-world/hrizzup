// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export declare const FEE_START_TIME = 1713292320000;
/**
 * Hrizzup's trading fee rate: the one setting for every fee a yes/no trade pays. Zero until the
 * Product chat decides the rate (an open question; PLAN.md has none for markets).
 *
 * A trade's fee is TAKER_FEE_RATE × p × (1 − p) × shares, Manifold's formula, where p is the
 * trade's average price: the most at 50%, nothing near 0% or 100%. It's taken from the stake
 * before shares are bought, and kept out of the pool (getFeesSplit).
 */
export declare const TAKER_FEE_RATE = 0;
export declare const getTakerFee: (shares: number, prob: number) => number;
export declare const getFeesSplit: (totalFees: number) => {
    creatorFee: number;
    platformFee: number;
    liquidityFee: number;
};
export declare const FLAT_TRADE_FEE = 0;
export declare const FLAT_COMMENT_FEE = 1;
export declare const DPM_PLATFORM_FEE = 0;
export declare const DPM_CREATOR_FEE = 0;
export declare const DPM_FEES: number;
export type Fees = {
    creatorFee: number;
    platformFee: number;
    liquidityFee: number;
};
export declare const noFees: Fees;
export declare const getFeeTotal: (fees: Fees) => number;
export declare const sumAllFees: (fees: Fees[]) => number;
