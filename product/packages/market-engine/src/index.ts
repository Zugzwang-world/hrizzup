/**
 * @hrizzup/market-engine: the market maths for Hrizzup's yes/no markets (PLAN.md step 1.7a).
 *
 * The maths is Manifold's, in `manifold/` (MIT licence, `manifold/LICENSE.md`); the package's
 * README says what was copied and what changed. This file is the package's front door: it
 * names the parts a yes/no market uses, one line per file they come from. Everything here is
 * plain calculation, with no database or network.
 */

// The error a refused trade raises.
export { APIError } from './manifold/api/utils.ts';
// Trades: a bet, a limit order, and the fills that make them up.
export type { Bet, fill, LimitBet, maker } from './manifold/bet.ts';
// A market's probability, and each person's position in it (which settlement reads).
export { getContractBetMetrics, getProbability } from './manifold/calculate.ts';
// The pool: probability, shares for a stake, the cost to reach a probability, liquidity, and
// matching against limit orders.
export {
  addCpmmLiquidity,
  type CpmmState,
  calculateCpmmAmountToProb,
  calculateCpmmPurchase,
  calculateCpmmShares,
  computeFills,
  getCpmmProbability,
} from './manifold/calculate-cpmm.ts';
// A market (our slim type), and the limits a trade can't push its price past: 1% and 99%.
export {
  type BinaryContract,
  type Contract,
  type CPMMContract,
  MAX_CPMM_PROB,
  MIN_CPMM_PROB,
  type resolution,
} from './manifold/contract.ts';
// A person's position in a market.
export type { ContractMetric } from './manifold/contract-metric.ts';
// Fees.
export { type Fees, getTakerFee, noFees } from './manifold/fees.ts';
// Money put into a market's pool, the starting amount included.
export type { LiquidityProvision } from './manifold/liquidity-provision.ts';
// Buying, with or without a limit price.
export {
  type BetInfo,
  type CandidateBet,
  computeCpmmBet,
  getBinaryCpmmBetInfo,
} from './manifold/new-bet.ts';
// Opening a market.
export { getNewContract } from './manifold/new-contract.ts';
// Settlement: Yes, No, a set probability (MKT) or cancel.
export { getPayouts, type Payout, type PayoutInfo } from './manifold/payouts.ts';
// Yes and No held together cancel out.
export {
  getBinaryRedeemableAmountFromContractMetric,
  getRedemptionBets,
} from './manifold/redeem.ts';
// Selling.
export { getCpmmSellBetInfo } from './manifold/sell-bet.ts';
