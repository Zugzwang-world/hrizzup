import type {
  CancelOrderInput,
  CancelOrderResult,
  ListedMarket,
  MarketList,
  OrdersPage,
  PositionsPage,
  Refusal,
  Side,
  TradeInput,
  TradeResult,
} from '@hrizzup/api';
import { errorCode, type Transaction, transaction } from '@hrizzup/db';
import {
  type TradeResult as BooksResult,
  micros,
  TradeInputError,
  type TradeRequest,
  trade,
} from '@hrizzup/ledger';
import type { Pool } from 'pg';

/**
 * The markets for everyone (PLAN.md step 1.7d; blueprint sections 5 and 13): the list anyone may
 * read, and for the signed-in person, trading, cancelling an order, and their own positions and open
 * orders. Each read is one transaction through the server's one database helper (`@hrizzup/db`), as
 * the app's own role, calling the database's own reads in schema `trading`; a trade runs through the
 * ledger's `trade()` (step 1.7b), each one transaction under its market's lock.
 *
 * A trade is refused **before it touches the books** when it can't trade: the contract refuses a
 * limit outside 1% to 99%, an expiry that isn't in the future and an amount that isn't more than zero
 * before the call runs at all; then this reads the person's holdings (`trading.holdings`) and
 * refuses a market that isn't open or whose closing time has passed, an amount over the balance and
 * shares over what's held, with no lock taken and nothing written. The ledger checks all of it again
 * under the market's lock, so a balance spent in the meantime is still refused there (and that
 * refusal is stored under the request's ID, as the books keep every answer).
 *
 * Refusals come back as a TradingError; `DatabaseBusyError` (from `@hrizzup/db`) means "try again".
 */

/** How many markets, positions or orders a page holds. */
export const PAGE_SIZE = 50;

/** Why a trading call was refused. */
export type TradingErrorKind =
  /** No such market, or one only admins can see yet (a draft). */
  | 'not_found'
  /** The request's ID was already used for a different request. */
  | 'conflict'
  /** What was sent can never trade as sent (such as an expiry already past by the database's clock). */
  | 'invalid'
  /** The books refuse it, for `reason`. */
  | 'refused';

export class TradingError extends Error {
  constructor(
    readonly kind: TradingErrorKind,
    message: string,
    readonly reason?: Refusal,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TradingError';
  }
}

/** What each refusal says, in words for people. */
const REFUSALS: Record<Refusal, string> = {
  market_not_open: "This market isn't taking bets",
  market_closed: 'This market has closed',
  insufficient_balance: 'That is more than your balance',
  not_enough_shares: 'That is more shares than you hold',
  price_limit: 'The price is at its limit',
  no_open_order: 'No such open order of yours in this market',
};

function refused(reason: Refusal): TradingError {
  return new TradingError('refused', REFUSALS[reason], reason);
}

/** A database or ledger failure as a TradingError, when it is one; anything else as it was. */
export function asTradingError(error: unknown): unknown {
  if (error instanceof TradingError) return error;
  if (error instanceof TradeInputError) {
    return new TradingError('invalid', error.message, undefined, { cause: error });
  }
  switch (errorCode(error)) {
    case '23505': // unique_violation: begin_trade's "already used for a different request"
      return new TradingError(
        'conflict',
        'This request ID was already used for a different request',
        undefined,
        { cause: error },
      );
    case 'P0002': // no_data_found: no such market (or, if the read before raced, no account)
      return new TradingError('not_found', 'No such market', undefined, { cause: error });
    case '22023': // invalid_parameter_value: a page cursor that isn't theirs, a page size
    case '22P02': // invalid_text_representation
      return new TradingError(
        'invalid',
        error instanceof Error ? error.message : 'Refused',
        undefined,
        { cause: error },
      );
    default:
      return error;
  }
}

type Database = Pick<Pool, 'connect'>;

/** One read, as one transaction for `account` (null: nobody signed in), answering one value. */
async function read<R>(
  pool: Database,
  account: string | null,
  sql: string,
  values: unknown[],
): Promise<R> {
  try {
    return await transaction(
      pool,
      async (tx: Transaction) => {
        const { rows } = await tx.query<{ answer: R }>(sql, values);
        const row = rows[0];
        if (!row) throw new Error('The database answered nothing');
        return row.answer;
      },
      { account },
    );
  } catch (error) {
    throw asTradingError(error);
  }
}

const sideOf = (outcome: string): Side => (outcome === 'YES' ? 'yes' : 'no');
const OUTCOME = { yes: 'YES', no: 'NO' } as const;
/** A moment from the database (`…+00:00`) as the agreement writes one (`…Z`). */
const utc = (moment: string) => new Date(moment).toISOString();

// The list ---------------------------------------------------------------------------------------------

/**
 * The markets anyone may see, newest first, a page at a time, each the agreement's record with its
 * probability now. Read with nobody signed in, whoever asks: the answer is the same for everyone, so
 * the API may keep it at the edge.
 */
export async function marketList(
  pool: Database,
  page: { after?: string | undefined } = {},
): Promise<MarketList> {
  const found = await read<{ markets: ListedMarket[]; next: string | null }>(
    pool,
    null,
    'select trading.markets($1, $2) as answer',
    [page.after ?? null, PAGE_SIZE],
  );
  return { markets: found.markets, next: found.next };
}

// Trading ----------------------------------------------------------------------------------------------

type Holdings = {
  market_id: string;
  state: string;
  closes_at: string;
  has_account: boolean;
  balance: string;
  yes: string;
  no: string;
};

/** The signed-in person's balance and shares in one market; null for no such market (or a draft). */
function holdings(pool: Database, account: string, marketId: string): Promise<Holdings | null> {
  return read<Holdings | null>(pool, account, 'select trading.holdings($1) as answer', [marketId]);
}

/**
 * Why the books would refuse this trade, by the person's holdings as just read and the server's
 * clock; undefined when nothing does. The same checks, in the same order, as the ledger's own inside
 * the trade (`refusalFor` in `@hrizzup/ledger`).
 */
export function refusalBefore(
  input: TradeInput,
  held: Holdings,
  now: number = Date.now(),
): Refusal | undefined {
  if (held.state !== 'open') return 'market_not_open';
  if (now >= Date.parse(held.closes_at)) return 'market_closed';
  if (input.action === 'buy' && micros(input.amount) > micros(held.balance)) {
    return 'insufficient_balance';
  }
  if (input.action === 'sell' && micros(input.shares) > micros(held[input.outcome])) {
    return 'not_enough_shares';
  }
  return undefined;
}

/** The trade as the ledger takes it. */
function asRequest(input: TradeInput): TradeRequest {
  const base = { requestId: input.requestId, marketId: input.marketId };
  if (input.action === 'sell') {
    return { ...base, action: 'sell', outcome: OUTCOME[input.outcome], shares: input.shares };
  }
  return {
    ...base,
    action: 'buy',
    outcome: OUTCOME[input.outcome],
    amount: input.amount,
    ...(input.limitProb === undefined ? {} : { limitProb: input.limitProb }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: new Date(input.expiresAt) }),
  };
}

function toTradeResult(result: Extract<BooksResult, { trade_id: string }>): TradeResult {
  return {
    status: result.status,
    requestId: result.request_id,
    marketId: result.market_id,
    tradeId: result.trade_id,
    outcome: sideOf(result.outcome),
    amount: result.amount,
    shares: result.shares,
    orderAmount: result.order_amount,
    limitProb: result.limit_prob,
    probBefore: result.prob_before,
    probAfter: result.prob_after,
    balance: result.balance,
    position: { yes: result.position.yes, no: result.position.no },
    at: utc(result.at),
  };
}

/**
 * A trade for the signed-in `account`: buying (now, or as a limit order) or selling. Refused before
 * it touches the books when the person's holdings show it can't trade; otherwise one transaction
 * through the ledger. A retry with the same request ID answers what the first did, and never trades
 * twice.
 */
export async function placeTrade(
  pool: Database,
  account: string,
  input: TradeInput,
  now: number = Date.now(),
): Promise<TradeResult> {
  const request = asRequest(input);
  const held = await holdings(pool, account, input.marketId);
  if (!held) throw new TradingError('not_found', 'No such market');
  const before = refusalBefore(input, held, now);
  if (before) throw refused(before);
  let result: BooksResult;
  try {
    result = await trade(pool, account, request);
  } catch (error) {
    throw asTradingError(error);
  }
  if (result.status === 'refused') throw refused(result.reason);
  if (result.status === 'cancelled') throw new Error('A trade was answered as a cancel');
  return toTradeResult(result);
}

/**
 * Cancels one of the signed-in person's own resting limit orders, with its own request ID: no money
 * moves. An order that's filled, cancelled, expired or someone else's is refused (`no_open_order`).
 */
export async function cancelOrder(
  pool: Database,
  account: string,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  const held = await holdings(pool, account, input.marketId);
  if (!held) throw new TradingError('not_found', 'No such market');
  // Someone with no play money yet has no orders: nothing to cancel, and nothing written.
  if (!held.has_account) throw refused('no_open_order');
  let result: BooksResult;
  try {
    result = await trade(pool, account, {
      action: 'cancel_order',
      requestId: input.requestId,
      marketId: input.marketId,
      orderId: input.orderId,
    });
  } catch (error) {
    throw asTradingError(error);
  }
  if (result.status === 'refused') throw refused(result.reason);
  if (result.status !== 'cancelled') throw new Error('A cancel was answered as a trade');
  return {
    status: 'cancelled',
    requestId: result.request_id,
    marketId: result.market_id,
    orderId: result.order_id,
  };
}

// The person's own -------------------------------------------------------------------------------------

type PositionRow = {
  market_id: string;
  question: string;
  state: PositionsPage['positions'][number]['state'];
  closes_at: string;
  yes: string;
  no: string;
  probability: string;
};

/** The signed-in person's balance and positions, newest market first, a page at a time. */
export async function positions(
  pool: Database,
  account: string,
  page: { after?: string | undefined } = {},
): Promise<PositionsPage> {
  const found = await read<{ balance: string; positions: PositionRow[]; next: string | null }>(
    pool,
    account,
    'select trading.positions($1, $2) as answer',
    [page.after ?? null, PAGE_SIZE],
  );
  return {
    balance: found.balance,
    positions: found.positions.map((row) => ({
      marketId: row.market_id,
      question: row.question,
      state: row.state,
      closesAt: row.closes_at,
      yes: row.yes,
      no: row.no,
      probability: row.probability,
    })),
    next: found.next,
  };
}

type OrderRow = {
  id: string;
  market_id: string;
  question: string;
  state: OrdersPage['orders'][number]['state'];
  outcome: string;
  order_amount: string;
  amount: string;
  shares: string;
  limit_prob: string;
  expires_at: string | null;
  created_at: string;
};

/** The signed-in person's resting limit orders, newest first, a page at a time. */
export async function openOrders(
  pool: Database,
  account: string,
  page: { after?: string | undefined } = {},
): Promise<OrdersPage> {
  const found = await read<{ orders: OrderRow[]; next: string | null }>(
    pool,
    account,
    'select trading.orders($1, $2) as answer',
    [page.after ?? null, PAGE_SIZE],
  );
  return {
    orders: found.orders.map((row) => ({
      id: row.id,
      marketId: row.market_id,
      question: row.question,
      state: row.state,
      outcome: sideOf(row.outcome),
      orderAmount: row.order_amount,
      amount: row.amount,
      shares: row.shares,
      limitProb: row.limit_prob,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
    next: found.next,
  };
}
