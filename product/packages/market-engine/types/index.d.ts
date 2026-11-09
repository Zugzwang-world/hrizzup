// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/**
 * @hrizzup/market-engine: the market maths for Hrizzup's yes/no markets (PLAN.md step 1.7a).
 *
 * The maths is Manifold's, in `manifold/` (MIT licence, `manifold/LICENSE.md`); the package's
 * README says what was copied and what changed. This file is the package's front door: it
 * names the parts a yes/no market uses, one line per file they come from. Everything here is
 * plain calculation, with no database, network or clock: every trade takes its time from the
 * caller, as `now`, in milliseconds since 1970.
 */
export { APIError } from './manifold/api/utils.ts';
export type { Bet, fill, LimitBet, maker } from './manifold/bet.ts';
export { getContractBetMetrics, getProbability } from './manifold/calculate.ts';
export { addCpmmLiquidity, type CpmmState, calculateCpmmAmountToProb, calculateCpmmPurchase, calculateCpmmShares, getCpmmProbability, } from './manifold/calculate-cpmm.ts';
export { type BinaryContract, type Contract, type CPMMContract, MAX_CPMM_PROB, MIN_CPMM_PROB, type resolution, } from './manifold/contract.ts';
export type { ContractMetric } from './manifold/contract-metric.ts';
export { type Fees, getTakerFee, noFees, TAKER_FEE_RATE } from './manifold/fees.ts';
export type { LiquidityProvision } from './manifold/liquidity-provision.ts';
export { type BetInfo, type CandidateBet, getBinaryCpmmBetInfo } from './manifold/new-bet.ts';
export { getNewContract } from './manifold/new-contract.ts';
export { getPayouts, type Payout, type PayoutInfo } from './manifold/payouts.ts';
export { getBinaryRedeemableAmountFromContractMetric, getRedemptionBets, } from './manifold/redeem.ts';
export { getCpmmSellBetInfo } from './manifold/sell-bet.ts';
