// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
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
export { getPerpOpenInterest, getPositionValue, liquidationPrice, type PerpPool, type PerpState, } from './manifold/perps/amm.ts';
export { isPerpEscrowBalanced } from './manifold/perps/escrow.ts';
export type { OraclePoint } from './manifold/perps/oracle.ts';
export { getUserFacingPnl, getUserFacingPnlFromPayout } from './manifold/perps/pnl.ts';
export type { PerpDirection, PerpPosition } from './manifold/perps/position.ts';
export { getPerpTradingModeForConfig, type PerpTradingMode, } from './manifold/perps/trading-mode.ts';
export { getBinaryRedeemableAmountFromContractMetric, getRedemptionBets, } from './manifold/redeem.ts';
export { getCpmmSellBetInfo } from './manifold/sell-bet.ts';
export { applyPerpFunding, applyPerpPrice, closePerpPosition, newPerpBook, openPerpPosition, type PerpBook, type PerpClosed, type PerpCloseRequest, type PerpFundingApplied, type PerpMove, type PerpOpened, type PerpOpenRequest, type PerpPriceApplied, type PerpRefusal, type PerpRefused, } from './perp/engine.ts';
export { assertPerpSettings, PERP_LEVERAGE_CAP, PERP_SETTINGS, type PerpSettings, } from './perp/settings.ts';
export { STAND_IN_PRICE, STAND_IN_SEED_PATTERN, standInPrice } from './perp/stand-in-price.ts';
