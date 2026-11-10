/**
 * @hrizzup/market-engine: the market maths for Hrizzup's yes/no markets (PLAN.md step 1.7a)
 * and its Bitcoin perp (step 3.4a).
 *
 * The maths is Manifold's, in `manifold/` (MIT licence, `manifold/LICENSE.md`); the perp's engine
 * steps, settings and stand-in price are ours, in `perp/`. The package's README says what was
 * copied and what changed. This file is the package's front door: it names the parts a yes/no
 * market and the perp use, one line per file they come from. Everything here is
 * plain calculation, with no database, network or clock: every trade takes its time from the
 * caller, as `now`, in milliseconds since 1970.
 */

// The error a refused trade raises.
export { APIError } from './manifold/api/utils.ts';
// Trades: a bet, a limit order, and the fills that make them up.
export type { Bet, fill, LimitBet, maker } from './manifold/bet.ts';
// A market's probability, and each person's position in it (which settlement reads).
export { getContractBetMetrics, getProbability } from './manifold/calculate.ts';
// The pool: probability, shares for a stake, the cost to reach a probability, and liquidity.
// (Matching against limit orders happens inside buying and selling, below, which take the time.)
export {
  addCpmmLiquidity,
  type CpmmState,
  calculateCpmmAmountToProb,
  calculateCpmmPurchase,
  calculateCpmmShares,
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
// Fees: one setting, TAKER_FEE_RATE, at zero until the rate is decided.
export { type Fees, getTakerFee, noFees, TAKER_FEE_RATE } from './manifold/fees.ts';
// Money put into a market's pool, the starting amount included.
export type { LiquidityProvision } from './manifold/liquidity-provision.ts';
// Buying, with or without a limit price.
export { type BetInfo, type CandidateBet, getBinaryCpmmBetInfo } from './manifold/new-bet.ts';
// Opening a market.
export { getNewContract } from './manifold/new-contract.ts';
// Settlement: Yes, No, a set probability (MKT) or cancel.
export { getPayouts, type Payout, type PayoutInfo } from './manifold/payouts.ts';
// Manifold's perps maths the books and screens read: positions, the pools, value and profit.
export {
  getPerpOpenInterest,
  getPositionValue,
  liquidationPrice,
  type PerpPool,
  type PerpState,
} from './manifold/perps/amm.ts';
// The cash-backing check: the money the perp holds equals its two pools.
export { isPerpEscrowBalanced } from './manifold/perps/escrow.ts';
// A price point.
export type { OraclePoint } from './manifold/perps/oracle.ts';
// Profit and loss as a trader sees it.
export { getUserFacingPnl, getUserFacingPnlFromPayout } from './manifold/perps/pnl.ts';
// A position.
export type { PerpDirection, PerpPosition } from './manifold/perps/position.ts';
// The off switch: on, closing only, or halted.
export {
  getPerpTradingModeForConfig,
  type PerpTradingMode,
} from './manifold/perps/trading-mode.ts';
// Yes and No held together cancel out.
export {
  getBinaryRedeemableAmountFromContractMetric,
  getRedemptionBets,
} from './manifold/redeem.ts';
// Selling.
export { getCpmmSellBetInfo } from './manifold/sell-bet.ts';
// The perp (step 3.4a). Its engine: opening, closing, a new price and funding, as plain
// calculation returning the new book and the play money to move.
export {
  applyPerpFunding,
  applyPerpPrice,
  closePerpPosition,
  newPerpBook,
  openPerpPosition,
  type PerpBook,
  type PerpClosed,
  type PerpCloseRequest,
  type PerpFundingApplied,
  type PerpMove,
  type PerpOpened,
  type PerpOpenRequest,
  type PerpPriceApplied,
  type PerpRefusal,
  type PerpRefused,
} from './perp/engine.ts';
// Its settings: Manifold's defaults, with leverage capped at 10 times.
export {
  assertPerpSettings,
  PERP_LEVERAGE_CAP,
  PERP_SETTINGS,
  type PerpSettings,
} from './perp/settings.ts';
// Its stand-in price: a new one every 5 seconds, from a secret seed.
export { STAND_IN_PRICE, STAND_IN_SEED_PATTERN, standInPrice } from './perp/stand-in-price.ts';
