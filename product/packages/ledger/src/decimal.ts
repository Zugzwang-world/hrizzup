/**
 * Exact play money (blueprint section 5, "The markets' books"): every amount and share count is
 * an exact decimal with six places, a millionth of a Ṁ, never floating point. The database
 * keeps them as numeric(20, 6) and sends them as text; here they are whole numbers of
 * millionths (`Micros`, a bigint), so adding and comparing them is exact.
 *
 * Manifold's maths works in floating point, so its results are rounded once: in the house's
 * favour for what changes hands (`down` for what a person receives, `up` for what a resting
 * order pays), to the nearest millionth otherwise (`fromNumber`); and parts that must add up to
 * a rounded total are rounded together (`split`), so they add up exactly.
 */

/** An exact amount, in millionths of a Ṁ (or of a share). */
export type Micros = bigint;

/** The decimal places every amount keeps. */
export const PLACES = 6;
const UNIT = 10n ** BigInt(PLACES);

/**
 * The largest amount the maths can be handed and give back exactly: past about 9 billion,
 * a millionth no longer fits in a floating-point number.
 */
export const LARGEST: Micros = BigInt(Number.MAX_SAFE_INTEGER);

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,6}))?$/;

/** A decimal sent as text ("12.5", "-0.000001") as exact millionths. */
export function micros(text: string): Micros {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new RangeError(`Not an amount with at most ${PLACES} places: ${text}`);
  const [, sign, whole = '0', fraction = ''] = match;
  const value = BigInt(whole) * UNIT + BigInt(fraction.padEnd(PLACES, '0'));
  return sign ? -value : value;
}

/** Exact millionths as decimal text with all six places ("12.500000"), as the database keeps them. */
export function decimal(value: Micros): string {
  const negative = value < 0n;
  const size = negative ? -value : value;
  const whole = size / UNIT;
  const fraction = (size % UNIT).toString().padStart(PLACES, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Exact millionths as a floating-point number, for Manifold's maths. */
export function toNumber(value: Micros): number {
  if (value > LARGEST || value < -LARGEST) throw new RangeError('Too large for the maths');
  return Number(value) / 1e6;
}

/** One of the maths' results, rounded once to the nearest millionth (halves away from zero). */
export function fromNumber(value: number): Micros {
  if (!Number.isFinite(value)) throw new RangeError(`The maths gave ${value}`);
  const scaled = Math.abs(value) * 1e6;
  if (scaled > Number.MAX_SAFE_INTEGER) throw new RangeError('Too large to round exactly');
  const rounded = BigInt(Math.round(scaled));
  return value < 0 ? -rounded : rounded;
}

/**
 * Rounds `parts` (the maths' figures, in Ṁ) to millionths that add up to exactly `total`: each
 * part is rounded down, then the millionths still missing go to the parts that lost the most
 * (the largest remainders), so no part moves by more than a millionth.
 */
export function split(total: Micros, parts: number[]): Micros[] {
  if (parts.length === 0) {
    if (total !== 0n) throw new RangeError('Nothing to split a non-zero total across');
    return [];
  }
  const sign = total < 0n ? -1n : 1n;
  const scaled = parts.map((part) => Math.abs(part) * 1e6);
  const rounded = scaled.map((part) => BigInt(Math.floor(part)));
  let missing = sign * total - rounded.reduce((sum, part) => sum + part, 0n);
  const byRemainder = scaled
    .map((part, index) => ({ index, remainder: part - Math.floor(part) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  // Usually under one millionth per part; any more (the maths' figures adding up to a little
  // more or less than the total) is spread the same way, a millionth at a time.
  for (let i = 0; missing !== 0n; i = (i + 1) % byRemainder.length) {
    const { index } = byRemainder[i] as { index: number };
    const step = missing > 0n ? 1n : -1n;
    if (step < 0n && (rounded[index] as bigint) === 0n) {
      if (rounded.every((part) => part === 0n)) throw new RangeError('Cannot split below zero');
      continue;
    }
    rounded[index] = (rounded[index] as bigint) + step;
    missing -= step;
  }
  return rounded.map((part) => sign * part);
}

/** The smaller of two amounts. */
export const min = (a: Micros, b: Micros): Micros => (a < b ? a : b);

/**
 * Floating point's own noise, in millionths, for a result of this size: a result within it of
 * a whole millionth counts as exactly that millionth. A double carries about 16 significant
 * digits, and Manifold's maths loses a few, so the window grows with the number (a millionth
 * of a millionth up to about Ṁ100, then 1e-14 of the number itself).
 */
const noise = (scaled: number) => Math.max(1e-6, scaled * 1e-14);

/**
 * One of the maths' results rounded once toward zero, to a millionth: for what a person
 * receives (shares, sale proceeds), so rounding never favours them. A result within floating
 * point's own noise of a whole millionth counts as that millionth.
 */
export function down(value: number): Micros {
  if (!Number.isFinite(value)) throw new RangeError(`The maths gave ${value}`);
  const scaled = Math.abs(value) * 1e6;
  if (scaled > Number.MAX_SAFE_INTEGER) throw new RangeError('Too large to round exactly');
  const nearest = Math.round(scaled);
  const rounded = BigInt(Math.abs(scaled - nearest) < noise(scaled) ? nearest : Math.floor(scaled));
  return value < 0 ? -rounded : rounded;
}

/**
 * One of the maths' results rounded once away from zero, to a millionth: for what a resting
 * order's owner pays for the shares they get, so rounding never favours them either. A result
 * within floating point's own noise of a whole millionth counts as that millionth.
 */
export function up(value: number): Micros {
  if (!Number.isFinite(value)) throw new RangeError(`The maths gave ${value}`);
  const scaled = Math.abs(value) * 1e6;
  if (scaled > Number.MAX_SAFE_INTEGER) throw new RangeError('Too large to round exactly');
  const nearest = Math.round(scaled);
  const rounded = BigInt(Math.abs(scaled - nearest) < noise(scaled) ? nearest : Math.ceil(scaled));
  return value < 0 ? -rounded : rounded;
}
