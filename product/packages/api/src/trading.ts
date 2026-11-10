import { type Market, validate } from '@hrizzup/agreement';
import { z } from 'zod';
import { decimal, marketState, moment, probability, recordId } from './console.ts';
import { forbidden } from './keys.ts';

/**
 * The markets' part of the contract for everyone (PLAN.md step 1.7d; blueprint section 13): the list
 * anyone may read, and for the signed-in person, trading (buy, sell, limit orders, cancelling one)
 * and their own positions and open orders. Reads shaped by the market pages' design (the price
 * chart, a market's own page, settled history) join at step 3.1's contract stage.
 *
 * Play money is exact decimal text, never a JSON number: amounts and shares to the millionth of a
 * Ṁ, probabilities to 8 decimal places, as the books keep them (`@hrizzup/ledger`).
 */

/** Yes or No: the side of a yes-or-no market a trade buys or sells. */
export const side = z.enum(['yes', 'no']);

/**
 * Play money or shares a person sends: more than zero, to the millionth (six decimal places at
 * most), written as text. Anything else, zero and below included, is refused before the books.
 */
export const positiveAmount = z
  .string()
  .regex(
    /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/,
    'Must be an amount written as text, such as "25" or "2.5", to the millionth at most',
  )
  .refine((value) => /[1-9]/.test(value), { message: 'Must be more than zero' });

/** A trade request's ID, chosen by whoever sends it: a retry sends the same one, so it never trades twice. */
export const requestId = z.uuid('Must be a UUID, chosen by the sender and sent again on a retry');

/** A resting limit order's ID (the trade's ID). */
export const orderId = z.uuid("Must be the order's ID");

/** Why the books refused a trade. Each is a 422, with the reason in its data. */
export const refusal = z.enum([
  /** The market isn't taking bets: a draft, closed, settled or cancelled. */
  'market_not_open',
  /** The market's closing time has passed. */
  'market_closed',
  /** The amount is more than the person's balance. */
  'insufficient_balance',
  /** More shares to sell than the person holds. */
  'not_enough_shares',
  /** The price is at its limit (1% or 99%), or the sale too small for the pool to price. */
  'price_limit',
  /** No such resting order of the person's in this market: filled, cancelled, expired or never theirs. */
  'no_open_order',
]);

/**
 * A trade: buying Yes or No with an amount of play money, now or as a limit order that rests until a
 * later trade reaches its price; or selling shares held. Each carries its own request ID. The call
 * refuses, before touching the books: a limit outside 1% to 99% and an amount or shares that aren't
 * more than zero (here, in the contract); then, once it has read the person's holdings, an expiry that
 * isn't in the future (zero included), an amount over the balance and shares over what's held. A
 * retry of a request the books have already answered gets that answer back instead, whatever has
 * changed since: the expiry is checked against the clock on the server for that reason, not here.
 */
const buy = z.strictObject({
  marketId: recordId,
  requestId,
  action: z.literal('buy'),
  outcome: side,
  /** Play money to spend: at most the balance. A limit order spends it only as it fills. */
  amount: positiveAmount,
  /**
   * A limit order, at a probability of Yes, as Manifold's are: buying Yes, only while the market's
   * probability is at most this; buying No, only while it's at least this.
   */
  limitProb: probability.optional(),
  /**
   * When a limit order stops resting, if ever: a moment in the future (the server refuses one that
   * isn't, zero included, unless the request was already answered). Only for a limit order.
   */
  expiresAt: moment.optional(),
});

const sell = z.strictObject({
  marketId: recordId,
  requestId,
  action: z.literal('sell'),
  outcome: side,
  /** Shares to sell: at most those held. */
  shares: positiveAmount,
});

export const tradeInput = z.discriminatedUnion('action', [buy, sell]).superRefine((input, ctx) => {
  if (input.action !== 'buy' || input.expiresAt === undefined) return;
  if (input.limitProb === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Only a limit order can expire', path: ['expiresAt'] });
  }
});

/** What a trade did, as the books wrote it. A retry of the same request answers the same. */
export const tradeResult = z.object({
  /** filled: done; partly_filled: a limit order, part of it resting; resting: a limit order, none filled yet. */
  status: z.enum(['filled', 'partly_filled', 'resting']),
  requestId: z.uuid(),
  marketId: recordId,
  /** The trade's ID; a limit order's ID, to cancel it by. */
  tradeId: z.uuid(),
  outcome: side,
  /** Play money paid, or (when below zero) received for a sale. */
  amount: decimal,
  /** Shares got, or (when below zero) sold. */
  shares: decimal,
  /** A buy's amount asked for: all of it spent unless it's a limit order still resting. */
  orderAmount: decimal.nullable(),
  limitProb: decimal.nullable(),
  /** The market's probability before and after the trade. */
  probBefore: decimal,
  probAfter: decimal,
  /** The person's balance and position in the market, after the trade. */
  balance: decimal,
  position: z.object({ yes: decimal, no: decimal }),
  /** When it traded, by the database's own clock. */
  at: moment,
});

/** Cancelling one of the person's own resting limit orders, with its own request ID. No money moves. */
export const cancelOrderInput = z.strictObject({ marketId: recordId, orderId, requestId });

export const cancelOrderResult = z.object({
  status: z.literal('cancelled'),
  requestId: z.uuid(),
  marketId: recordId,
  orderId: z.uuid(),
});

/** A market as the agreement writes it (market/1), checked by the agreement's own check. */
export const marketRecord = z.custom<Market>().superRefine((value, ctx) => {
  if ((value as { format?: unknown } | null | undefined)?.format !== 'market/1') {
    ctx.addIssue({ code: 'custom', message: 'Must be a market (market/1)', path: ['format'] });
    return;
  }
  for (const problem of validate(value)) {
    ctx.addIssue({
      code: 'custom',
      message: problem.message,
      path: problem.path.split('/').filter(Boolean),
    });
  }
});

/** A market in the list: the agreement's record, and the probability its pool shows while it trades. */
export const listedMarket = z.object({
  market: marketRecord,
  /**
   * The probability of Yes while it's open or closed; null once settled or cancelled (the record
   * says how), and for a market with several outcomes, which the engine doesn't trade yet.
   */
  probability: decimal.nullable(),
});

/** A page of the markets anyone may see, newest first, and where the next page starts (null on the last). */
export const marketList = z.object({ markets: z.array(listedMarket), next: recordId.nullable() });

/** One of the person's positions: their shares in a market still open or waiting to be settled. */
export const position = z.object({
  marketId: recordId,
  question: z.string(),
  state: marketState,
  closesAt: moment,
  yes: decimal,
  no: decimal,
  /** The market's probability now. */
  probability: decimal,
});

/** The person's balance, and a page of their positions, newest market first. */
export const positionsPage = z.object({
  balance: decimal,
  positions: z.array(position),
  next: recordId.nullable(),
});

/** One of the person's resting limit orders. */
export const openOrder = z.object({
  id: z.uuid(),
  marketId: recordId,
  question: z.string(),
  state: marketState,
  outcome: side,
  /** What the order may spend in all. */
  orderAmount: decimal,
  /** What it has spent so far, and the shares that got. */
  amount: decimal,
  shares: decimal,
  limitProb: decimal,
  expiresAt: moment.nullable(),
  createdAt: moment,
});

/** A page of the person's open orders, newest first. */
export const ordersPage = z.object({ orders: z.array(openOrder), next: z.uuid().nullable() });

/** Where a page of positions starts: after the last market of the page before. */
export const positionsPageInput = z.strictObject({ after: recordId.optional() }).optional();

/** Where a page of open orders starts: after the last order of the page before. */
export const ordersPageInput = z.strictObject({ after: orderId.optional() }).optional();

/** The errors a trading call may answer, besides a refused input (400, BAD_REQUEST). */
export const tradingErrors = {
  UNAUTHORIZED: { status: 401, message: 'Not signed in' },
  /** A read-only API key: only a trading key may trade. */
  FORBIDDEN: forbidden,
  NOT_FOUND: { status: 404, message: 'No such market' },
  CONFLICT: {
    status: 409,
    message: 'This request ID was already used for a different request',
  },
  REFUSED: {
    status: 422,
    message: 'The trade was refused',
    data: z.object({ reason: refusal }),
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Too many trades: try again in a moment',
    data: z.object({ retryAfterSeconds: z.number().int().positive() }),
  },
  SERVICE_UNAVAILABLE: { status: 503, message: 'The database is busy: try again' },
} as const;

/**
 * The errors a personal read (your balance, positions and orders) may answer: nobody signed in (or
 * an API key that isn't valid), or more than an API key's reads a minute.
 */
export const personalReadErrors = {
  UNAUTHORIZED: tradingErrors.UNAUTHORIZED,
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Too many reads with this key: try again in a moment',
    data: z.object({ retryAfterSeconds: z.number().int().positive() }),
  },
  SERVICE_UNAVAILABLE: tradingErrors.SERVICE_UNAVAILABLE,
} as const;

export type Side = z.infer<typeof side>;
export type Refusal = z.infer<typeof refusal>;
export type TradeInput = z.output<typeof tradeInput>;
export type TradeResult = z.infer<typeof tradeResult>;
export type CancelOrderInput = z.output<typeof cancelOrderInput>;
export type CancelOrderResult = z.infer<typeof cancelOrderResult>;
export type ListedMarket = z.infer<typeof listedMarket>;
export type MarketList = z.infer<typeof marketList>;
export type Position = z.infer<typeof position>;
export type PositionsPage = z.infer<typeof positionsPage>;
export type OpenOrder = z.infer<typeof openOrder>;
export type OrdersPage = z.infer<typeof ordersPage>;
