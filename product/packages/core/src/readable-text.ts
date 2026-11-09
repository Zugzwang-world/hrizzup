/**
 * The readable-text check (PLAN.md step 1.4): text must stand out from what's behind it, in
 * the light and the dark colour scheme alike. Contrast is measured the way the Web Content
 * Accessibility Guidelines (WCAG 2.2) measure it, from 1 (none) to 21 (black on white), and
 * every text colour must reach 4.5 to 1 on its background, the level WCAG sets for normal
 * text, so no text style can slip under it by being smaller than planned.
 *
 * There are no design values yet: design starts only from the founder's references and
 * diagrams, given in the design chat. When the values arrive, every text colour is listed on
 * each background it sits on, in light and dark, and a test in the code that holds them
 * expects `unreadable(pairs)` to be empty. The Speed check also audits the contrast of the
 * text on every page, in both schemes (`product/web/e2e/speed-check.ts`).
 */

/** A colour as six-digit hex (`#RRGGBB`), which both the website and the app read. */
export type Hex = `#${string}`;

/** One text colour on one background, as a screen uses them. */
export type TextPair = {
  /** What the pair is, for the check's report: "Text on a card (dark)". */
  name: string;
  text: Hex;
  on: Hex;
};

/** The minimum contrast for text (WCAG 2.2, level AA, normal text). */
export const READABLE = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A colour's relative luminance, from 0 (black) to 1 (white). */
export function luminance(hex: Hex): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${hex} isn't a six-digit hex colour`);
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** The contrast ratio between two colours, from 1 to 21. */
export function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every pair whose text falls under 4.5 to 1, described for the check's report. */
export function unreadable(pairs: readonly TextPair[]): string[] {
  return pairs
    .map((pair) => ({ pair, ratio: contrast(pair.text, pair.on) }))
    .filter(({ ratio }) => ratio < READABLE)
    .map(
      ({ pair, ratio }) => `${pair.name}: ${pair.text} on ${pair.on} is ${ratio.toFixed(2)} to 1`,
    );
}
