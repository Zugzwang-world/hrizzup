import { addObjects } from './util/object.ts';

export const FEE_START_TIME = 1713292320000;

/**
 * Hrizzup's trading fee rate: the one setting for every fee a yes/no trade pays. Zero until the
 * Product chat decides the rate (an open question; PLAN.md has none for markets).
 *
 * A trade's fee is TAKER_FEE_RATE × p × (1 − p) × shares, Manifold's formula, where p is the
 * trade's average price: the most at 50%, nothing near 0% or 100%. It's taken from the stake
 * before shares are bought, and kept out of the pool (getFeesSplit).
 */
export const TAKER_FEE_RATE = 0;
export const getTakerFee = (shares: number, prob: number) => {
  return TAKER_FEE_RATE * prob * (1 - prob) * shares;
};

export const getFeesSplit = (totalFees: number) => {
  return {
    creatorFee: 0,
    platformFee: totalFees,
    liquidityFee: 0,
  };
};

export const FLAT_TRADE_FEE = 0;
export const FLAT_COMMENT_FEE = 1;

export const DPM_PLATFORM_FEE = 0.0;
export const DPM_CREATOR_FEE = 0.0;
export const DPM_FEES = DPM_PLATFORM_FEE + DPM_CREATOR_FEE;

export type Fees = {
  creatorFee: number;
  platformFee: number;
  liquidityFee: number;
};

export const noFees: Fees = {
  creatorFee: 0,
  platformFee: 0,
  liquidityFee: 0,
};

export const getFeeTotal = (fees: Fees) => {
  return fees.creatorFee + fees.platformFee + fees.liquidityFee;
};

export const sumAllFees = (fees: Fees[]) => {
  let totalFees = noFees;
  fees.forEach((totalFee) => {
    totalFees = addObjects(totalFees, totalFee);
  });
  return getFeeTotal(totalFees);
};
