import { z } from 'zod';
import { decimal, moment, probability, recordId } from './console.ts';
import { nextCursor, pageFields } from './paging.ts';
import { leverage, margin, perpAmount, perpDirection, perpRefusal } from './perps.ts';
import { positiveAmount, refusal, side, sideInput } from './trading.ts';

/**
 * The public API's market data (PLAN.md steps 3.5c and 3.4b; docs/research/public-api.md, sections
 * 2.1 and 2.8): the reads every market page and every bot needs, public, needing no key, the same
 * for everyone, so each is kept at Vercel's edge, and never naming who traded (decision 5). One
 * market; its history; its resting limit orders by price beside the pool's price; its latest trades;
 * a quote for any size; the perp's quote; and our own Bitcoin price and its history.
 *
 * Names follow Manifold's where ours mean the same (`probability`, `outcome`, `amount`, `shares`,
 * `limitProb`, `probBefore`, `probAfter`, `orderAmount`); play money and probabilities are exact
 * decimal text, times ISO 8601 (the ground rules, paging.ts).
 */

/** The usual ranges a history covers: the last hour, day, week or 30 days, or everything. */
export const historyRange = z.enum(['1h', '1d', '1w', '1m', 'all']);

/** A market by its address. */
export const marketAddress = z.strictObject({ id: recordId });

/** A market's history, over a range (everything since it opened, when not sent). */
export const marketHistoryInput = z.strictObject({ id: recordId, range: historyRange.optional() });

/** The chance of Yes at a moment: after a trade, or as the range starts. */
export const probabilityPoint = z.object({ at: moment, probability: decimal });

/**
 * A yes-or-no market's chance of Yes after each trade in the range, in time order, starting with its
 * chance as the range starts. At most 1,000 points: when the range holds more trades, the last of
 * each of 1,000 equal slices of it.
 */
export const marketHistory = z.object({
  marketId: recordId,
  range: historyRange,
  /** Where the range starts: that long ago, or when the market opened if that's later. */
  from: moment,
  points: z.array(probabilityPoint),
});

/** What rests at one price: the play money still unfilled there, and how many orders hold it. */
export const bookLevel = z.object({
  limitProb: decimal,
  amount: decimal,
  orders: z.number().int().positive(),
});

/**
 * The resting limit orders, by price, beside the pool's price; there's no central order book, since
 * a trade fills against the pool and any resting orders it reaches (Manifold's engine). Each side's
 * best first: Yes orders highest first (each buys Yes while the probability is at most its limit),
 * No orders lowest first (each buys No while it's at least its limit). No names.
 */
export const marketBook = z.object({
  marketId: recordId,
  /** The pool's probability of Yes now; null once the market is settled or cancelled. */
  probability: decimal.nullable(),
  yes: z.array(bookLevel),
  no: z.array(bookLevel),
});

/** A market's latest trades: its address, where the page starts and how many to a page. */
export const marketTradesInput = z.strictObject({ id: recordId, ...pageFields });

/**
 * One trade as it was placed, with no name: a buy or a sale, what it paid (below zero, what it
 * received) and the shares it got (below zero, sold) then, and the probability before and after.
 */
export const publicTrade = z.object({
  id: z.uuid(),
  outcome: side,
  action: z.enum(['buy', 'sell']),
  amount: decimal,
  shares: decimal,
  /** A limit order's price; null for a trade at the market. */
  limitProb: decimal.nullable(),
  probBefore: decimal,
  probAfter: decimal,
  at: moment,
});

/** A page of a market's latest trades, newest first, and where the next page starts. */
export const marketTrades = z.object({
  marketId: recordId,
  trades: z.array(publicTrade),
  next: nextCursor,
});

/** A quote's size: at most 1,000,000,000 (Ṁ or shares), far past any balance, within the maths' range. */
const quoteSize = positiveAmount.refine((value) => Number(value) <= 1_000_000_000, {
  message: 'At most 1,000,000,000',
});

/**
 * A quote: a buy of `amount` (now, or as a limit order at `limitProb`), or a sale of `shares`, run
 * through the same maths a trade runs, on the market as it stands, writing nothing. A trade sent next
 * with the same figures fills exactly so, to the millionth, unless another trade comes between.
 */
export const marketQuoteInput = z
  .strictObject({
    id: recordId,
    /** A buy (when not sent) or a sale. */
    action: z.enum(['buy', 'sell']).optional(),
    outcome: sideInput,
    /** A buy's play money to spend. */
    amount: quoteSize.optional(),
    /** A sale's shares to sell. */
    shares: quoteSize.optional(),
    /** A limit buy's price: buys only while the probability is at most this (Yes) or at least it (No). */
    limitProb: probability.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.action === 'sell') {
      if (input.shares === undefined) {
        ctx.addIssue({ code: 'custom', message: 'A sale needs its shares', path: ['shares'] });
      }
      if (input.amount !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'A sale takes shares, not an amount',
          path: ['amount'],
        });
      }
      if (input.limitProb !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'Only a buy has a limit', path: ['limitProb'] });
      }
    } else {
      if (input.amount === undefined) {
        ctx.addIssue({ code: 'custom', message: 'A buy needs its amount', path: ['amount'] });
      }
      if (input.shares !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'A buy takes an amount, not shares',
          path: ['shares'],
        });
      }
    }
  });

/** What a trade with these figures would do now, as the books would write it. */
export const marketQuote = z.object({
  marketId: recordId,
  action: z.enum(['buy', 'sell']),
  outcome: side,
  /** filled; or, for a limit buy, partly_filled (the rest would rest) or resting (none fills now). */
  status: z.enum(['filled', 'partly_filled', 'resting']),
  /** Play money paid now, or (below zero) received for a sale. */
  amount: decimal,
  /** Shares got now, or (below zero) sold. */
  shares: decimal,
  /** A buy's amount asked for. */
  orderAmount: decimal.nullable(),
  limitProb: decimal.nullable(),
  /** Play money a share, on average (amount over shares); null when nothing fills now. */
  averagePrice: decimal.nullable(),
  probBefore: decimal,
  probAfter: decimal,
  /**
   * A buy: what its shares pay if the outcome wins (Ṁ1 each). A sale: the play money it receives.
   */
  payout: decimal,
  /** When it was quoted, by the database's own clock. */
  at: moment,
});

/** Why a quote can't be given: the trade it describes would be refused, for this reason. */
export const quoteRefusal = refusal.extract(['market_not_open', 'market_closed', 'price_limit']);

/** The errors a market read may answer, besides the common ones: no such market (or a draft). */
export const marketReadErrors = {
  NOT_FOUND: { status: 404, message: 'No such market' },
} as const;

export const quoteErrors = {
  ...marketReadErrors,
  REFUSED: {
    status: 422,
    message: 'That trade would be refused',
    data: z.object({ reason: quoteRefusal }),
  },
} as const;

// The perp's quote ---------------------------------------------------------------------------------------

/** Opening a position of `margin` at `leverage`, as `perps.open` takes it. */
export const perpQuoteInput = z.strictObject({
  id: recordId,
  direction: perpDirection,
  margin,
  leverage,
  /** The most fee accepted; needed only while a perp's size fee is on. */
  maxFee: perpAmount.optional(),
});

/**
 * What an open would do at the price now, run through the same maths, writing nothing. An order fills
 * at the next price, a few seconds on, so its fee and liquidation price move with it.
 */
export const perpQuote = z.object({
  perpId: recordId,
  direction: perpDirection,
  margin: decimal,
  leverage: decimal,
  /** The position's size (notional): margin times leverage. */
  size: decimal,
  /** The opening fee (closing is free), rounded up to the millionth, as the books charge it. */
  fee: decimal,
  /** What the open takes from the balance: the margin and the fee. */
  cost: decimal,
  /** The price now, which the quote is at, and its time. */
  price: decimal,
  priceAt: moment,
  /** Where the position would be liquidated at that price: a long at or below it, a short at or above. */
  liquidationPrice: decimal,
  /** When it was quoted, by the database's own clock. */
  at: moment,
});

export const perpQuoteErrors = {
  NOT_FOUND: { status: 404, message: 'No such perp' },
  REFUSED: {
    status: 422,
    message: 'That open would be refused',
    data: z.object({ reason: perpRefusal }),
  },
} as const;

// Our own price (step 3.4b) ------------------------------------------------------------------------------

/** Our own prices: Bitcoin in US dollars. */
export const priceFeed = z.enum(['btc-usd']);

export const priceAddress = z.strictObject({ feed: priceFeed });

/**
 * Our own price, stored once about every 5 seconds: the median of Coinbase's, Kraken's and Bitstamp's
 * free public prices (Gemini standing by), to the cent. The website, the app, every bot and the perp
 * use this one price; no exchange's own price is ever given.
 */
export const price = z.object({
  feed: priceFeed,
  price: decimal,
  /** When the exchanges were asked for it. */
  at: moment,
  /** How many exchanges' answers made it: 2 or 3; 0 when the last price is held (up to 30 seconds). */
  sources: z.number().int().min(0).max(3),
  /** When it was stored. */
  publishedAt: moment,
});

export const priceHistoryInput = z.strictObject({
  feed: priceFeed,
  range: historyRange.optional(),
});

/** A price at a moment. */
export const pricePoint = z.object({ at: moment, price: decimal });

/**
 * The price over a range (the last day, when not sent), in time order: every stored price (each 5
 * seconds for 30 days, then each minute's last), or the last of each of 1,000 equal slices of the
 * range when it holds more.
 */
export const priceHistory = z.object({
  feed: priceFeed,
  range: historyRange,
  from: moment,
  points: z.array(pricePoint),
});

export type HistoryRange = z.infer<typeof historyRange>;
export type MarketHistory = z.infer<typeof marketHistory>;
export type MarketBook = z.infer<typeof marketBook>;
export type PublicTrade = z.infer<typeof publicTrade>;
export type MarketTrades = z.infer<typeof marketTrades>;
export type MarketQuoteInput = z.output<typeof marketQuoteInput>;
export type MarketQuote = z.infer<typeof marketQuote>;
export type QuoteRefusal = z.infer<typeof quoteRefusal>;
export type PerpQuoteInput = z.output<typeof perpQuoteInput>;
export type PerpQuote = z.infer<typeof perpQuote>;
export type PriceFeed = z.infer<typeof priceFeed>;
export type Price = z.infer<typeof price>;
export type PriceHistory = z.infer<typeof priceHistory>;
