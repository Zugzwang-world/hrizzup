import { randomUUID } from 'node:crypto';
import type {
  HistoryRange,
  ListedMarket,
  MarketBook,
  MarketHistory,
  MarketQuote,
  MarketQuoteInput,
  MarketTrades,
  PublicTrade,
} from '@hrizzup/api';
import { type MarketState, type QuoteRequest, quoteTrade } from '@hrizzup/ledger';
import type { Pool } from 'pg';
import { PAGE_SIZE, REFUSALS, read, TradingError } from './trading.ts';

/**
 * The public API's market data (PLAN.md step 3.5c; docs/research/public-api.md, section 2.8): one
 * market, its history, its resting orders by price, its latest trades and a quote for any size. Each
 * is one read, with nobody signed in, of the database's own functions in schema `market_data`, which
 * never name who traded, so the answer is the same for everyone and the API keeps it at the edge.
 *
 * A quote runs the trade's own maths (`quoteTrade` in `@hrizzup/ledger`) on the market as a trade
 * would find it (`market_data.quote_state`), writing nothing: a trade sent next with the same figures
 * fills exactly as quoted, to the millionth, unless another trade comes between.
 */

type Database = Pick<Pool, 'connect'>;

const OUTCOME = { yes: 'YES', no: 'NO' } as const;
const sideOf = (outcome: string) => (outcome === 'YES' ? 'yes' : 'no');
const utc = (moment: string) => new Date(moment).toISOString();

function notFound(): TradingError {
  return new TradingError('not_found', 'No such market');
}

/** One market by its address: any that isn't a draft, listed or not, as the list gives it. */
export async function oneMarket(pool: Database, id: string): Promise<ListedMarket> {
  const found = await read<ListedMarket | null>(
    pool,
    null,
    'select market_data.one_market($1) as answer',
    [id],
  );
  if (!found) throw notFound();
  return found;
}

/** A market's chance of Yes after each trade over a range (everything, when not given). */
export async function marketHistory(
  pool: Database,
  id: string,
  range: HistoryRange = 'all',
): Promise<MarketHistory> {
  const found = await read<Omit<MarketHistory, 'marketId'> | null>(
    pool,
    null,
    'select market_data.market_history($1, $2) as answer',
    [id, range],
  );
  if (!found) throw notFound();
  return { marketId: id, range: found.range, from: utc(found.from), points: found.points };
}

/** A market's resting limit orders by price, beside the pool's price. */
export async function marketBook(pool: Database, id: string): Promise<MarketBook> {
  const found = await read<Omit<MarketBook, 'marketId'> | null>(
    pool,
    null,
    'select market_data.book($1) as answer',
    [id],
  );
  if (!found) throw notFound();
  return { marketId: id, probability: found.probability, yes: found.yes, no: found.no };
}

/** A trades page's cursor: the trade number its page starts before, as `next` gave it. */
const TRADE_CURSOR = /^[1-9][0-9]{0,8}$/;

type StoredTrade = Omit<PublicTrade, 'outcome'> & { outcome: string };

/** A market's latest trades, newest first, a page at a time. */
export async function marketTrades(
  pool: Database,
  id: string,
  page: { cursor?: string | undefined; limit?: number | undefined } = {},
): Promise<MarketTrades> {
  if (page.cursor !== undefined && !TRADE_CURSOR.test(page.cursor)) {
    throw new TradingError('invalid', 'Not a cursor from this list: send back the `next` it gave');
  }
  const found = await read<{ trades: StoredTrade[]; next: number | null } | null>(
    pool,
    null,
    'select market_data.trades($1, $2, $3) as answer',
    [id, page.cursor === undefined ? null : Number(page.cursor), page.limit ?? PAGE_SIZE],
  );
  if (!found) throw notFound();
  return {
    marketId: id,
    trades: found.trades.map((trade) => ({ ...trade, outcome: sideOf(trade.outcome) })),
    next: found.next === null ? null : String(found.next),
  };
}

/** What `market_data.quote_state` gives: the market as a trade would find it, nobody's own. */
type QuoteState = Omit<MarketState, 'account' | 'position'>;

/**
 * The market as a trade would find it, for `asker`: their balance and position in it. A public quote
 * (no asker) can pay exactly what it asks about: the amount it would spend, the shares it would sell.
 */
export async function quoteStateFor(
  pool: Database,
  id: string,
  asker: { balance: string; position: { yes: string; no: string } },
): Promise<MarketState | null> {
  const found = await read<QuoteState | null>(
    pool,
    null,
    'select market_data.quote_state($1) as answer',
    [id],
  );
  if (!found) return null;
  return { ...found, account: { id: 'quote', balance: asker.balance }, position: asker.position };
}

/** The quote's request, as the ledger takes a trade's (its request ID is never used). */
function quoteRequest(input: MarketQuoteInput): QuoteRequest {
  const base = { requestId: randomUUID(), marketId: input.id, outcome: OUTCOME[input.outcome] };
  if (input.action === 'sell') {
    if (input.shares === undefined) throw new TradingError('invalid', 'A sale needs its shares');
    return { ...base, action: 'sell', shares: input.shares };
  }
  if (input.amount === undefined) throw new TradingError('invalid', 'A buy needs its amount');
  return {
    ...base,
    action: 'buy',
    amount: input.amount,
    ...(input.limitProb === undefined ? {} : { limitProb: input.limitProb }),
  };
}

/** Runs the quote's maths on `state`, as a trade's own would: refused as the trade would be. */
export function quoteOn(input: MarketQuoteInput, state: MarketState): MarketQuote {
  const request = quoteRequest(input);
  const quote = quoteTrade(request, state);
  if ('refusal' in quote) {
    throw new TradingError('refused', REFUSALS[quote.refusal], quote.refusal);
  }
  return {
    marketId: input.id,
    action: request.action,
    outcome: input.outcome,
    status: quote.status,
    amount: quote.amount,
    shares: quote.shares,
    orderAmount: quote.orderAmount,
    limitProb: quote.limitProb,
    averagePrice: quote.averagePrice,
    probBefore: quote.probBefore,
    probAfter: quote.probAfter,
    payout: quote.payout,
    at: utc(state.now),
  };
}

/**
 * A public quote for any size: what a buy (now or as a limit order) or a sale would do now, as if the
 * asker could pay exactly what they ask about. Refused as the trade would be: a market that isn't
 * open or is past its closing time, or a price at its limit.
 */
export async function marketQuote(pool: Database, input: MarketQuoteInput): Promise<MarketQuote> {
  const selling = input.action === 'sell' ? input.shares : undefined;
  const state = await quoteStateFor(pool, input.id, {
    balance: input.action === 'sell' ? '0' : (input.amount ?? '0'),
    position: {
      yes: input.outcome === 'yes' && selling ? selling : '0',
      no: input.outcome === 'no' && selling ? selling : '0',
    },
  });
  if (!state) throw notFound();
  return quoteOn(input, state);
}
