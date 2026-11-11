import { decimal, type Micros, micros } from './decimal.ts';
import {
  type MarketState,
  type Outcome,
  planTrade,
  type Refusal,
  type TradeRequest,
} from './plan.ts';

/**
 * A quote (PLAN.md step 3.5c; docs/research/public-api.md, section 2.8): what a buy or a sale would do
 * now, worked out exactly as the trade would be. It runs the trade's own plan (`planTrade`, Manifold's
 * maths rounded once) on the market as the database hands it over, then works out what the database
 * would write from that plan: the pool, as `markets.apply_trade` works it out from the money the market
 * holds and everyone's shares, and the probability, as `markets.probability` rounds it. It reads no
 * clock and touches no database, so a trade sent next on the same market state fills exactly as
 * quoted, to the millionth.
 */

export type QuoteRequest = Extract<TradeRequest, { action: 'buy' | 'sell' }>;

export type Quote =
  | {
      /** filled; or, for a limit buy, partly_filled (the rest would rest) or resting. */
      status: 'filled' | 'partly_filled' | 'resting';
      /** Play money paid now, or (below zero) received for a sale. */
      amount: string;
      /** Shares got now, or (below zero) sold. */
      shares: string;
      orderAmount: string | null;
      limitProb: string | null;
      /** Play money a share (amount over shares, to 8 places); null when nothing fills now. */
      averagePrice: string | null;
      probBefore: string;
      probAfter: string;
      /** A buy: what its shares pay if the outcome wins (Ṁ1 each). A sale: the money it receives. */
      payout: string;
      /** The pool the database would hold afterwards. */
      pool: { yes: string; no: string };
    }
  | { refusal: Refusal };

const TEN = 10n;
const pow10 = (n: number) => TEN ** BigInt(n);

/** Rounds `numerator / denominator` (both above zero) to a whole number, halves away from zero. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const whole = numerator / denominator;
  const rest = numerator % denominator;
  return rest * 2n >= denominator ? whole + 1n : whole;
}

/** A value's weight and first digit in Postgres's base-10000 numerals (`NumericVar`), at `scale`. */
function weightAndFirstDigit(value: bigint, scale: number): { weight: number; first: bigint } {
  // Postgres groups digits in fours from the decimal point: pad the fraction to a multiple of four.
  const fractionGroups = Math.ceil(scale / 4);
  let groups = value * pow10(fractionGroups * 4 - scale);
  if (groups === 0n) return { weight: 0, first: 0n };
  let index = -1;
  let first = 0n;
  while (groups > 0n) {
    index += 1;
    first = groups % 10000n;
    groups /= 10000n;
    // The most significant non-zero group is the last one met.
  }
  // `first` now holds the most significant group (non-zero, since groups > 0 before it).
  return { weight: index - fractionGroups, first };
}

/**
 * Postgres's `numerator / denominator` for two numerics of the same `scale` (`select_div_scale`, then
 * the quotient rounded at that scale, halves away from zero), then `round(…, places)`: the same double
 * rounding the database does, so the answer matches it digit for digit. Both above zero. Gives the
 * result as a whole number of 10^-places.
 */
export function postgresDivideRound(
  numerator: bigint,
  denominator: bigint,
  scale: number,
  places: number,
): bigint {
  if (numerator <= 0n || denominator <= 0n)
    throw new Error('Postgres division here is of positives');
  const a = weightAndFirstDigit(numerator, scale);
  const b = weightAndFirstDigit(denominator, scale);
  let quotientWeight = a.weight - b.weight;
  if (a.first <= b.first) quotientWeight -= 1;
  // NUMERIC_MIN_SIG_DIGITS (16), never below either input's display scale, nor above 1000.
  const resultScale = Math.min(Math.max(16 - quotientWeight * 4, scale, 0), 1000);
  const atScale = roundedQuotient(numerator * pow10(resultScale), denominator);
  if (resultScale <= places) return atScale * pow10(places - resultScale);
  return roundedQuotient(atScale, pow10(resultScale - places));
}

/**
 * A pool's probability of Yes, exactly as `markets.probability` gives it:
 * round(p·n / ((1 − p)·y + p·n), 8), with p to 8 places and the pool to 6.
 */
export function probabilityOf(p: string, poolYes: Micros, poolNo: Micros): string {
  const P = scaled(p, 8);
  const numerator = P * poolNo; // scale 14
  const denominator = (pow10(8) - P) * poolYes + P * poolNo; // scale 14
  const result = postgresDivideRound(numerator, denominator, 14, 8);
  return fixed(result, 8);
}

/** Exact decimal text as a whole number of 10^-places (no more places than that). */
function scaled(text: string, places: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Not a decimal: ${text}`);
  const [, whole = '0', fraction = ''] = match;
  if (fraction.length > places) throw new Error(`More than ${places} places: ${text}`);
  return BigInt(whole) * pow10(places) + BigInt(fraction.padEnd(places, '0') || '0');
}

/** A whole number of 10^-places as text with exactly that many places, as Postgres writes it. */
function fixed(value: bigint, places: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(places + 1, '0');
  const text = `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return negative ? `-${text}` : text;
}

/**
 * A quote for `request` on the market as `state` shows it, the asker able to pay for it: `state`'s
 * account and position are the asker's (a quote with no one asking gives them exactly the amount or
 * the shares asked for). A refusal the trade would get comes back as one.
 */
export function quoteTrade(request: QuoteRequest, state: MarketState): Quote {
  const plan = planTrade(request, state, '00000000-0000-4000-8000-000000000000');
  if (plan.refusal) return { refusal: plan.refusal };
  const fills = plan.fills ?? [];
  const makers = plan.makers ?? [];
  const sum = (values: string[]) => values.reduce((total, value) => total + micros(value), 0n);
  const amount = sum(fills.map((fill) => fill.amount));
  const shares = sum(fills.map((fill) => fill.shares));

  // The pool afterwards, as the database works it out: the money the market holds less everyone's
  // shares, on each side. Money in: the trade's (below zero for a sale) and each resting order's it
  // filled; shares out: the trade's on its side, each order's on its own. (Yes and No held together
  // are paid out at Ṁ1 a pair, which takes the same from the money and from both sides' shares.)
  const outcomeOf = new Map(state.orders.map((order) => [order.id, order.outcome]));
  let money = amount;
  const sharesOut: Record<Outcome, Micros> = { YES: 0n, NO: 0n };
  sharesOut[request.outcome] += shares;
  for (const maker of makers) {
    const side = outcomeOf.get(maker.order_id);
    if (!side)
      throw new Error(`The plan filled an order the market doesn't have: ${maker.order_id}`);
    money += micros(maker.amount);
    sharesOut[side] += micros(maker.shares);
  }
  const before = { yes: micros(state.market.pool_yes), no: micros(state.market.pool_no) };
  const after = { yes: before.yes + money - sharesOut.YES, no: before.no + money - sharesOut.NO };
  if (after.yes <= 0n || after.no <= 0n) throw new Error('A quote would empty a side of the pool');

  const isBuy = request.action === 'buy';
  const isFilled = plan.trade?.is_filled ?? true;
  const status = !isBuy || isFilled ? 'filled' : amount === 0n ? 'resting' : 'partly_filled';
  const magnitude = (value: Micros) => (value < 0n ? -value : value);
  const averagePrice =
    shares === 0n
      ? null
      : fixed(roundedQuotient(magnitude(amount) * pow10(8), magnitude(shares)), 8);
  return {
    status,
    amount: decimal(amount),
    shares: decimal(shares),
    orderAmount: plan.trade?.order_amount ?? null,
    limitProb: plan.trade?.limit_prob ?? null,
    averagePrice,
    probBefore: probabilityOf(state.market.p, before.yes, before.no),
    probAfter: probabilityOf(state.market.p, after.yes, after.no),
    payout: decimal(isBuy ? shares : -amount),
    pool: { yes: decimal(after.yes), no: decimal(after.no) },
  };
}
