/**
 * The perp's stand-in price (PLAN.md step 3.4a), until the real Bitcoin price replaces it (3.4b).
 *
 * - **A new price every 5 seconds:** every moment in one 5-second step has the same price.
 * - **Seeded and pure:** the same seed and moment always give the same price, on any machine,
 *   with no state kept between calls, so tests repeat exactly and a job that runs every 5 seconds
 *   needs only the time.
 * - **Moving the way Bitcoin does:** a random walk of its logarithm (the standard model of a
 *   traded price), with Bitcoin's typical yearly volatility of about 55%: about 0.6% in an hour,
 *   3% in a day and 8% in a week. That is enough for 10-times positions to be liquidated (a 10%
 *   move against them) and for funding to change hands, as on the real thing.
 *
 * How a moment's price is found directly, without walking from the start: each 2^24 steps (about
 * 2.7 years) form a stretch whose end is drawn first; then the stretch is halved again and again,
 * each midpoint drawn between its two ends (a "Brownian bridge", the textbook way to build a random
 * walk from the top down). A moment's price needs only the 24 midpoints on its way down, and two
 * nearby moments share all but the last few, so neighbouring prices move as a walk should. Every
 * draw comes from a hash of the seed and the point's place, never from `Math.random`.
 */
import type { OraclePoint } from '../manifold/perps/oracle.ts';
import { YEAR_MS } from '../manifold/util/time.ts';

export const STAND_IN_PRICE = {
  /** The feed's name (not one Manifold stamps itself: see `orders.ts`). */
  feedId: 'stand-in-btc-usd',
  /** A new price every 5 seconds (the founder's decision, 10 November 2026). */
  intervalMs: 5_000,
  /** The walk starts here, at `startPrice`: midnight UTC on 1 January 2026. */
  origin: Date.UTC(2026, 0, 1),
  /** US dollars, about where Bitcoin traded in late 2026. */
  startPrice: 100_000,
  /** Bitcoin's typical yearly volatility, roughly its long-run realised level. */
  annualVolatility: 0.55,
  /** The seed staging uses; tests choose their own. */
  defaultSeed: 1,
} as const;

/** Steps in one stretch of the walk: 2^24, about 2.7 years of 5-second steps. */
const STRETCH = 2 ** 24;
const STRETCH_LEVELS = 24;

/** The volatility of one 5-second step. */
const STEP_VOLATILITY =
  STAND_IN_PRICE.annualVolatility * Math.sqrt(STAND_IN_PRICE.intervalMs / YEAR_MS);

/** A 32-bit integer from four, well mixed (MurmurHash3's finaliser, which is public domain). */
const mix = (a: number, b: number, c: number, d: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  for (const k of [b, c, d]) {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ k;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** A standard normal draw for one point of the walk (Box and Muller's method). */
const normal = (seed: number, stretch: number, index: number) => {
  const u1 = (mix(seed, stretch, index, 1) + 0.5) / 2 ** 32;
  const u2 = (mix(seed, stretch, index, 2) + 0.5) / 2 ** 32;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** The walk at a step, in units of one step's spread (a sum of `step` standard normals). */
const walk = (seed: number, step: number) => {
  const stretch = Math.floor(step / STRETCH);
  // Where this stretch starts: the ends of the stretches before it, each drawn whole.
  let start = 0;
  for (let s = 0; s < stretch; s++) start += Math.sqrt(STRETCH) * normal(seed, s, STRETCH);
  const end = start + Math.sqrt(STRETCH) * normal(seed, stretch, STRETCH);
  // Halve the stretch down to the step, drawing each midpoint between its ends.
  const offset = step - stretch * STRETCH;
  let lo = 0;
  let hi = STRETCH;
  let atLo = start;
  let atHi = end;
  for (let level = 0; level < STRETCH_LEVELS; level++) {
    const mid = (lo + hi) / 2;
    const atMid = (atLo + atHi) / 2 + Math.sqrt((hi - lo) / 4) * normal(seed, stretch, mid);
    if (offset < mid) {
      hi = mid;
      atHi = atMid;
    } else {
      lo = mid;
      atLo = atMid;
    }
  }
  return offset === lo ? atLo : atHi;
};

/**
 * The stand-in price at a moment: the price of the 5-second step the moment falls in, and the
 * step's start (`ts`), when that price was published. Rounded to the cent, as Bitcoin is quoted.
 */
export const standInPrice = (seed: number, moment: number): OraclePoint => {
  if (!Number.isSafeInteger(seed)) throw new Error('the seed must be a whole number');
  if (!Number.isFinite(moment) || moment < STAND_IN_PRICE.origin)
    throw new Error('the stand-in price starts on 1 January 2026');
  const step = Math.floor((moment - STAND_IN_PRICE.origin) / STAND_IN_PRICE.intervalMs);
  const logPrice =
    Math.log(STAND_IN_PRICE.startPrice) +
    STEP_VOLATILITY * walk(seed | 0, step) -
    // Without this, the average price would drift upwards over time (a log walk's own bias).
    (STEP_VOLATILITY ** 2 * step) / 2;
  return {
    ts: STAND_IN_PRICE.origin + step * STAND_IN_PRICE.intervalMs,
    price: Math.round(Math.exp(logPrice) * 100) / 100,
  };
};
