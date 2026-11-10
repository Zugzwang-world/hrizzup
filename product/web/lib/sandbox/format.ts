/**
 * How the markets sandbox (/sandbox) writes chances, prices and lines. Play money and probabilities
 * stay the exact decimal text the books keep: they are only reformatted, never turned into floating-
 * point numbers, except where a figure is plainly an estimate for the screen (a perp's price line,
 * its liquidation price before it opens), and those say "about".
 */

const MARKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A probability (`0.4812`) in whole cents, as Kalshi rounds a price: 48. Exact, by whole numbers. */
export function cents(probability: string): number {
  const [whole = '0', fraction = ''] = probability.split('.');
  const scaled = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  return Number((scaled + 500_000n) / 1_000_000n);
}

/** A probability as a chance, in whole percent: `0.4812` is "48%". */
export function chance(probability: string): string {
  return `${cents(probability)}%`;
}

/** The price of a Yes share in cents (the chance), and of a No share (the rest of a dollar). */
export function yesCents(probability: string): number {
  return Math.min(99, Math.max(1, cents(probability)));
}
export function noCents(probability: string): number {
  return 100 - yesCents(probability);
}

/**
 * An ID just above another in the order the market list uses (newest first, an ID after another
 * when it is smaller). The list answers "the markets after this one", so asking it for the page
 * after the ID just above a market's returns that market first: the one way to read a single market
 * with the calls the API has. Null when the sum would no longer be a market's ID.
 */
export function justAbove(id: string): string | null {
  if (!MARKET_ID.test(id)) return null;
  const next = (BigInt(`0x${id.replaceAll('-', '')}`) + 1n).toString(16).padStart(32, '0');
  const above = `${next.slice(0, 8)}-${next.slice(8, 12)}-${next.slice(12, 16)}-${next.slice(16, 20)}-${next.slice(20)}`;
  return MARKET_ID.test(above) ? above : null;
}

/** A chance typed into a field, as the number: "45", "45%" and " 45.5 " all read. */
export function typedPercent(typed: string): string {
  return typed.replace(/[%\s]/g, '');
}

/** An amount typed into a field: no spaces, no thousands commas, no Ṁ sign. */
export function typedAmount(typed: string): string {
  return typed.replace(/[Ṁ,\s]/g, '');
}

/** An amount of play money as a plain number text, to six decimals at most, trailing zeros dropped. */
export function plainAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const text = (Math.floor(value * 1_000_000) / 1_000_000).toFixed(6);
  return text.replace(/\.?0+$/, '');
}

/** A share of the balance (25, 50 or 100 percent), as an amount to type, never past `cap`. */
export function shareOf(balance: string, percent: number, cap = Number.POSITIVE_INFINITY): string {
  return plainAmount(Math.min((Number(balance) * percent) / 100, cap));
}

// A price line ------------------------------------------------------------------------------------------

export type LinePoint = { at: number; value: number };

export type Line = {
  /** The line as an SVG path (steps, as Kalshi's), in a viewBox of `width` by `height`. */
  path: string;
  min: number;
  max: number;
};

/**
 * The geometry of a small price line from what the page has seen: a stepped line over the time since
 * the first point, its height scaled to the range seen (with a little room above and below), so a
 * move of a cent shows. One point draws a flat line.
 */
export function lineOf(
  points: readonly LinePoint[],
  width: number,
  height: number,
  floor = 0,
  ceiling = Number.POSITIVE_INFINITY,
): Line | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const room = Math.max((max - min) * 0.15, Math.abs(max) * 0.0005, 1e-9);
  min = Math.max(floor, min - room);
  max = Math.min(ceiling, max + room);
  if (max - min < 1e-9) max = min + 1e-9;
  const span = Math.max(last.at - first.at, 1);
  const x = (at: number) => ((at - first.at) / span) * width;
  const y = (value: number) => height - ((value - min) / (max - min)) * height;
  let path = `M0 ${y(first.value).toFixed(2)}`;
  for (const point of points.slice(1)) {
    path += ` H${x(point.at).toFixed(2)} V${y(point.value).toFixed(2)}`;
  }
  if (points.length === 1) path += ` H${width}`;
  return { path, min, max };
}

// The perp -----------------------------------------------------------------------------------------------

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A price in US dollars for the screen: $74,250.12. */
export function usd(price: number | string): string {
  const value = Number(price);
  return Number.isFinite(value) ? USD.format(value) : '–';
}

/** A change in a price, with its sign: "+$907.00 (+1.2%)", "−$12.50 (−0.02%)". */
export function change(from: number, to: number): string {
  const delta = to - from;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const percent = from === 0 ? 0 : (Math.abs(delta) / from) * 100;
  return `${sign}${USD.format(Math.abs(delta))} (${sign}${percent.toFixed(2)}%)`;
}

/** Where a position is liquidated, to the cent, as Manifold's maths has it: its entry price moved by 1 / leverage. */
export function liquidationAbout(
  direction: 'long' | 'short',
  price: number,
  leverage: number,
): number {
  if (leverage <= 1 && direction === 'long') return 0;
  return direction === 'long' ? (1 - 1 / leverage) * price : (1 + 1 / leverage) * price;
}

/** The most margin a balance can open at a leverage: the opening fee comes on top of it. */
export function mostMargin(balance: string, leverage: number, feeBps: string): number {
  const feeShare = (leverage * Number(feeBps)) / 10_000;
  // A hair under, so the fee's rounding can never tip the order over the balance.
  return Math.max(0, Number(balance) / (1 + feeShare) - 0.000_002);
}

/** A funding rate (a share of the paying side's pool for the period), as a percentage: 0.0002 is "0.02%". */
export function ratePercent(rate: string): string {
  const value = Number(rate) * 100;
  if (!Number.isFinite(value)) return '–';
  return `${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0')}%`;
}

/** Play money in a perp's books, rounded for the screen: Ṁ12,345.68. */
export function roughMoney(value: number): string {
  return `Ṁ${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** A leverage as people say it: "3.9x", "10x". */
export function times(leverage: number | string): string {
  const value = Number(leverage);
  return `${Number.isInteger(value) ? value : value.toFixed(1)}x`;
}

/** A sign for a profit or loss written as exact text: "+Ṁ12.5" or "−Ṁ3". */
export function signed(decimal: string, money: (decimal: string) => string): string {
  if (decimal.startsWith('-')) return money(decimal);
  return /^0(?:\.0*)?$/.test(decimal) ? money(decimal) : `+${money(decimal)}`;
}

/** An exact decimal as plain text, for the screen: no Ṁ sign, at most `places` decimals (cut, not rounded), grouped by thousands. */
export function plain(decimal: string, places = 6): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-IN');
  const rest = fraction.slice(0, places).replace(/0+$/, '');
  return `${negative ? '−' : ''}${grouped}${rest ? `.${rest}` : ''}`;
}

/** Play money for the screen, at most four decimals: Ṁ990.099, −Ṁ12.5. The books keep the rest. */
export function short(decimal: string): string {
  const text = plain(decimal, 4);
  return text.startsWith('−') ? `−Ṁ${text.slice(1)}` : `Ṁ${text}`;
}
