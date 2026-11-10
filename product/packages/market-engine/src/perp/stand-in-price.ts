/**
 * The perp's stand-in price (PLAN.md step 3.4a), until the real Bitcoin price replaces it (3.4b).
 *
 * - **A new price every 5 seconds:** every moment in one 5-second step has the same price.
 * - **Seeded and pure:** the same seed and moment always give the same price, with no state kept
 *   between calls (on the same Node version, which the repository pins: JavaScript's `Math.exp`,
 *   `Math.log` and `Math.cos` may round their last bit differently between engines), so tests repeat exactly and a job that runs every 5 seconds
 *   needs only the time.
 * - **The seed is a secret key:** this code is public, so a guessable seed would let anyone work
 *   out every future price and trade on it. Every draw is a keyed hash of the seed (HalfSipHash,
 *   a standard keyed hash made for exactly this), so the code alone reveals nothing; tests use
 *   their own fixed seeds, and staging's lives outside the repository, with its other keys.
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
 * draw comes from a keyed hash of the point's place, never from `Math.random`.
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
} as const;

/** A seed: 16 hexadecimal digits, the 64-bit key of the hash. */
export const STAND_IN_SEED_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Where a walk starts, at what price, and how much it moves in a year. The Bitcoin perp walks
 * `STAND_IN_PRICE`'s; a check run's test perp walks one of its own (R5: a later start, so its steps
 * stay few, and a far higher volatility, so a run can see a liquidation within a minute). Its 5-second
 * steps start at its origin.
 */
export type StandInWalk = { origin: number; startPrice: number; annualVolatility: number };

const BITCOIN_WALK: StandInWalk = {
  origin: STAND_IN_PRICE.origin,
  startPrice: STAND_IN_PRICE.startPrice,
  annualVolatility: STAND_IN_PRICE.annualVolatility,
};

/** Steps in one stretch of the walk: 2^24, about 2.7 years of 5-second steps. */
const STRETCH = 2 ** 24;
const STRETCH_LEVELS = 24;

/** The volatility of one 5-second step, for a walk moving this much in a year. */
const stepVolatility = (annualVolatility: number) =>
  annualVolatility * Math.sqrt(STAND_IN_PRICE.intervalMs / YEAR_MS);

/**
 * HalfSipHash-2-4 (Aumasson and Bernstein's keyed hash, 32-bit output) of whole 32-bit words,
 * written from its specification; it gives the reference's first test vector (see the tests).
 * Written with plain local variables and the rounds inline, since a price takes 48 of these.
 */
export const halfSipHash = (key: readonly [number, number], words: readonly number[]) => {
  let v0 = key[0] >>> 0;
  let v1 = key[1] >>> 0;
  let v2 = (0x6c796765 ^ key[0]) >>> 0;
  let v3 = (0x74656462 ^ key[1]) >>> 0;
  // Each word, then the length block, takes two rounds; the finish takes four.
  for (let i = 0; i <= words.length + 1; i++) {
    const last = i === words.length + 1;
    const word = i < words.length ? (words[i] as number) >>> 0 : ((words.length * 4) << 24) >>> 0;
    if (last) v2 = (v2 ^ 0xff) >>> 0;
    else v3 = (v3 ^ word) >>> 0;
    for (let r = 0; r < (last ? 4 : 2); r++) {
      v0 = (v0 + v1) >>> 0;
      v1 = (((v1 << 5) | (v1 >>> 27)) ^ v0) >>> 0;
      v0 = ((v0 << 16) | (v0 >>> 16)) >>> 0;
      v2 = (v2 + v3) >>> 0;
      v3 = (((v3 << 8) | (v3 >>> 24)) ^ v2) >>> 0;
      v0 = (v0 + v3) >>> 0;
      v3 = (((v3 << 7) | (v3 >>> 25)) ^ v0) >>> 0;
      v2 = (v2 + v1) >>> 0;
      v1 = (((v1 << 13) | (v1 >>> 19)) ^ v2) >>> 0;
      v2 = ((v2 << 16) | (v2 >>> 16)) >>> 0;
    }
    if (!last) v0 = (v0 ^ word) >>> 0;
  }
  return (v1 ^ v3) >>> 0;
};

type Key = readonly [number, number];

/** The seed as the hash's key: two 32-bit words, read little-endian as the reference does. */
let lastSeed = '';
let lastKey: Key = [0, 0];

const keyOf = (seed: string): Key => {
  if (seed === lastSeed) return lastKey;
  if (!STAND_IN_SEED_PATTERN.test(seed))
    throw new Error('the seed must be 16 lowercase hexadecimal digits');
  const bytes = seed.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
  const word = (at: number) =>
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0;
  lastKey = [word(0), word(4)];
  lastSeed = seed;
  return lastKey;
};

/** A standard normal draw for one point of the walk (Box and Muller's method). */
const normal = (key: Key, stretch: number, index: number) => {
  const u1 = (halfSipHash(key, [stretch, index, 1]) + 0.5) / 2 ** 32;
  const u2 = (halfSipHash(key, [stretch, index, 2]) + 0.5) / 2 ** 32;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** The walk at a step, in units of one step's spread (a sum of `step` standard normals). */
const walk = (key: Key, step: number) => {
  const stretch = Math.floor(step / STRETCH);
  // Where this stretch starts: the ends of the stretches before it, each drawn whole.
  let start = 0;
  for (let s = 0; s < stretch; s++) start += Math.sqrt(STRETCH) * normal(key, s, STRETCH);
  const end = start + Math.sqrt(STRETCH) * normal(key, stretch, STRETCH);
  // Halve the stretch down to the step, drawing each midpoint between its ends.
  const offset = step - stretch * STRETCH;
  let lo = 0;
  let hi = STRETCH;
  let atLo = start;
  let atHi = end;
  for (let level = 0; level < STRETCH_LEVELS; level++) {
    const mid = (lo + hi) / 2;
    const atMid = (atLo + atHi) / 2 + Math.sqrt((hi - lo) / 4) * normal(key, stretch, mid);
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
 * Without `along`, the Bitcoin perp's walk (`STAND_IN_PRICE`); a test perp passes its own.
 */
export const standInPrice = (
  seed: string,
  moment: number,
  along: StandInWalk = BITCOIN_WALK,
): OraclePoint => {
  const key = keyOf(seed);
  const { origin, startPrice, annualVolatility } = along;
  if (
    !Number.isFinite(origin) ||
    !(startPrice > 0) ||
    !Number.isFinite(startPrice) ||
    !(annualVolatility > 0) ||
    !Number.isFinite(annualVolatility)
  )
    throw new Error('a walk starts somewhere, at a price above zero, moving by more than zero');
  if (!Number.isFinite(moment) || moment < origin)
    throw new Error(
      along === BITCOIN_WALK
        ? 'the stand-in price starts on 1 January 2026'
        : 'the stand-in price starts at its walk’s origin',
    );
  const stepVol = stepVolatility(annualVolatility);
  const step = Math.floor((moment - origin) / STAND_IN_PRICE.intervalMs);
  const logPrice =
    Math.log(startPrice) +
    stepVol * walk(key, step) -
    // Without this, the average price would drift upwards over time (a log walk's own bias).
    (stepVol ** 2 * step) / 2;
  return {
    ts: origin + step * STAND_IN_PRICE.intervalMs,
    price: Math.round(Math.exp(logPrice) * 100) / 100,
  };
};
