/**
 * The perp's settings (PLAN.md section 2, "Perps"; step 3.4a).
 *
 * The founder's decision of 10 November 2026: Manifold's defaults, as its code sets them, with
 * leverage capped at 10 times. Each value below says where in Manifold's code (commit 79997aa,
 * the one `manifold/` was copied from) it comes from. Manifold leaves some of them to whoever
 * creates a perp; for those, the value is the one Manifold's own code recommends for its Bitcoin
 * perp (`backend/shared/src/perps/launch-manifest.ts`, "Bitcoin price (USD)").
 *
 * Every change to these values goes into the rule-change log, with its date and its reason
 * (PLAN.md, "A rule-change log from the first day"); the log comes with the perp's books.
 */
import { assertPerpFundingConfig, MIN_PERP_LEVERAGE } from '../manifold/perps/amm.ts';
import {
  assertPerpTakerFeeConfig,
  PERP_TAKER_FEE_BPS_DEFAULT,
  PERP_TAKER_FEE_IMPACT_DEFAULT,
} from '../manifold/perps/fees.ts';
import { FUNDING_PERIOD_MS } from '../manifold/perps/funding.ts';
import { MINUTE_MS, YEAR_MS } from '../manifold/util/time.ts';

/** The most leverage a position may have: the founder's cap (PLAN.md, "Starting rules"). */
export const PERP_LEVERAGE_CAP = 10;

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

/** Manifold's yearly cap on funding for its Bitcoin perp (`annualMaxFundingRate`: 100%). */
const ANNUAL_MAX_FUNDING_RATE = 1;

export const PERP_SETTINGS: PerpSettings = {
  // Manifold recommends 5 for Bitcoin (`maxLeverage`); the founder set 10.
  maxLeverage: PERP_LEVERAGE_CAP,
  // `PERP_TAKER_FEE_BPS_DEFAULT` (fees.ts): 10 basis points, 0.1% of the size. Its cap,
  // `PERP_TAKER_FEE_BPS_MAX` (100), bounds any later change (`assertPerpSettings`).
  takerFeeBps: PERP_TAKER_FEE_BPS_DEFAULT,
  // `PERP_TAKER_FEE_IMPACT_DEFAULT` (fees.ts): 0, so the fee is the flat rate.
  takerFeeImpact: PERP_TAKER_FEE_IMPACT_DEFAULT,
  // `FUNDING_PERIOD_MS` (funding.ts): hourly.
  fundingPeriodMs: FUNDING_PERIOD_MS,
  // Bitcoin's recommendation: `fundingSensitivity: 1`.
  fundingSensitivity: 1,
  // Bitcoin's `annualMaxFundingRate: 1`, turned into a cap per period the way Manifold's
  // creation script does (`create-mnx-perps.ts`): yearly rate × period ÷ year.
  maxFundingRate: (ANNUAL_MAX_FUNDING_RATE * FUNDING_PERIOD_MS) / YEAR_MS,
  // Bitcoin's `maxOraclePriceAgeMs`: 2 minutes.
  maxPriceAgeMs: 2 * MINUTE_MS,
  // Bitcoin's `subsidyLong` and `subsidyShort`: Ṁ25,000 each.
  subsidyLong: 25_000,
  subsidyShort: 25_000,
};

/**
 * Refuses settings the engine must never run on: leverage outside 1 to the cap, and the funding
 * and fee bounds Manifold's own engine enforces (`assertPerpFundingConfig`,
 * `assertPerpTakerFeeConfig`).
 */
export const assertPerpSettings = (settings: PerpSettings) => {
  const { maxLeverage, fundingPeriodMs, maxPriceAgeMs, subsidyLong, subsidyShort } = settings;
  if (
    !Number.isFinite(maxLeverage) ||
    maxLeverage < MIN_PERP_LEVERAGE ||
    maxLeverage > PERP_LEVERAGE_CAP
  )
    throw new Error(`max leverage must be from ${MIN_PERP_LEVERAGE} to ${PERP_LEVERAGE_CAP}`);
  assertPerpFundingConfig(settings);
  assertPerpTakerFeeConfig(settings);
  if (!Number.isFinite(fundingPeriodMs) || fundingPeriodMs < FUNDING_PERIOD_MS)
    throw new Error('the funding period must be at least an hour');
  if (!Number.isFinite(maxPriceAgeMs) || maxPriceAgeMs <= 0)
    throw new Error('the price age limit must be positive');
  if (!(subsidyLong > 0) || !(subsidyShort > 0) || !Number.isFinite(subsidyLong + subsidyShort))
    throw new Error('each pool must start with a positive amount');
};
