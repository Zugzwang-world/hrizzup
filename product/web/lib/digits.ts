/**
 * Digits as people read them, by plain string arithmetic: the thousands commas and the rounding of
 * a figure. Nothing here asks the browser's locale formatting for anything, so a page that shows
 * play money or a price never makes the browser load its locale data while the page is loading
 * (the Speed check's busy time). The output is what the browser's own formatting printed before.
 */

/** Digits grouped the Indian way (the last three, then pairs): 1234567 is "12,34,567". */
export function groupIndian(d: string): string {
  if (d.length <= 3) return d;
  return `${d.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${d.slice(-3)}`;
}

/** Digits grouped in threes: 1234567 is "1,234,567". */
export function groupWestern(d: string): string {
  return d.replace(/\B(?=(\d{3})+$)/g, ',');
}

/** A number's digits, rounded to `places` decimals, half away from zero, on its shortest decimal form. */
export type RoundedDigits = { negative: boolean; whole: string; fraction: string };

/**
 * The digits of a finite number rounded to at most `places` decimals. It rounds half away from zero
 * on the shortest decimal text that reads back as the same number, so 2.675 gives 2.68 (never
 * `toFixed`, which reads the stored 2.67499999...). A minus zero, and a negative that rounds to
 * zero, keep their minus. The fraction can come back shorter than `places`: callers pad it or drop
 * its trailing zeros.
 */
export function roundedDigits(value: number, places: number): RoundedDigits {
  const negative = value < 0 || Object.is(value, -0);
  let text = String(Math.abs(value));
  if (text.includes('e')) {
    // Exponent forms (1e+21, 1.5e-7) become plain digits first.
    const [mantissa = '', exponent = '0'] = text.split('e');
    const digits = mantissa.replace('.', '');
    const point =
      (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(exponent);
    text =
      point <= 0
        ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length
          ? digits + '0'.repeat(point - digits.length)
          : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const [whole0 = '0', fraction0 = ''] = text.split('.');
  let whole = whole0;
  let fraction = fraction0;
  if (fraction.length > places) {
    const up = (fraction[places] ?? '0') >= '5';
    fraction = fraction.slice(0, places);
    if (up) {
      // Add one in the last kept place, carrying through the fraction and then the whole part.
      const kept = `${whole}${fraction}`;
      const bumped = (BigInt(kept) + 1n).toString().padStart(kept.length, '0');
      whole = bumped.slice(0, bumped.length - fraction.length);
      fraction = bumped.slice(bumped.length - fraction.length);
    }
  }
  return { negative, whole, fraction };
}
