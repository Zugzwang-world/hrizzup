// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
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
export declare const STAND_IN_PRICE: {
    /** The feed's name (not one Manifold stamps itself: see `orders.ts`). */
    readonly feedId: "stand-in-btc-usd";
    /** A new price every 5 seconds (the founder's decision, 10 November 2026). */
    readonly intervalMs: 5000;
    /** The walk starts here, at `startPrice`: midnight UTC on 1 January 2026. */
    readonly origin: number;
    /** US dollars, about where Bitcoin traded in late 2026. */
    readonly startPrice: 100000;
    /** Bitcoin's typical yearly volatility, roughly its long-run realised level. */
    readonly annualVolatility: 0.55;
};
/** A seed: 16 hexadecimal digits, the 64-bit key of the hash. */
export declare const STAND_IN_SEED_PATTERN: RegExp;
/**
 * Where a walk starts, at what price, and how much it moves in a year. The Bitcoin perp walks
 * `STAND_IN_PRICE`'s; a check run's test perp walks one of its own (R5: a later start, so its steps
 * stay few, and a far higher volatility, so a run can see a liquidation within a minute). Its 5-second
 * steps start at its origin.
 */
export type StandInWalk = {
    origin: number;
    startPrice: number;
    annualVolatility: number;
};
/**
 * HalfSipHash-2-4 (Aumasson and Bernstein's keyed hash, 32-bit output) of whole 32-bit words,
 * written from its specification; it gives the reference's first test vector (see the tests).
 * Written with plain local variables and the rounds inline, since a price takes 48 of these.
 */
export declare const halfSipHash: (key: readonly [number, number], words: readonly number[]) => number;
/**
 * The stand-in price at a moment: the price of the 5-second step the moment falls in, and the
 * step's start (`ts`), when that price was published. Rounded to the cent, as Bitcoin is quoted.
 * Without `along`, the Bitcoin perp's walk (`STAND_IN_PRICE`); a test perp passes its own.
 */
export declare const standInPrice: (seed: string, moment: number, along?: StandInWalk) => OraclePoint;
