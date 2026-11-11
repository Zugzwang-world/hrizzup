import { randomUUID } from 'node:crypto';
import type {
  HistoryRange,
  PerpQuote,
  PerpQuoteInput,
  Price,
  PriceFeed,
  PriceHistory,
} from '@hrizzup/api';
import { transaction } from '@hrizzup/db';
import { decimal, micros } from '@hrizzup/ledger';
import type { Pool } from 'pg';
import { planStep, type StepState } from './plan.ts';
import { PerpNotSetUpError, type PriceSource, priceFor } from './step.ts';
import { asPerpTradingError, PerpTradingError } from './trading.ts';

/**
 * The perp's and our own price's public reads (PLAN.md steps 3.5c and 3.4b): the newest price and its
 * history, and a quote for opening a position. Each is one read, with nobody signed in, of the
 * database's own functions in schema `market_data`, which name nobody, so the API keeps each answer
 * at the edge a moment.
 *
 * A perp quote runs the step's own maths (`planStep`, Manifold's, rounded once as the books are) on
 * the perp as an open placed now would find it (`market_data.perp_quote_state`), as if placed just
 * before the price now, by someone with nothing open and money enough, writing nothing. The order
 * itself fills at the next price, a few seconds on, so its fee and liquidation price move with it.
 */

type Database = Pick<Pool, 'connect'>;

/** No stored price yet: the reads answer "try again in a moment". */
export class NoPriceYetError extends Error {
  constructor() {
    super('No price yet: try again in a moment');
    this.name = 'NoPriceYetError';
  }
}

async function read<R>(pool: Database, sql: string, values: unknown[]): Promise<R> {
  try {
    return await transaction(
      pool,
      async (tx) => {
        const { rows } = await tx.query<{ answer: R }>(sql, values);
        return rows[0]?.answer as R;
      },
      { account: null },
    );
  } catch (error) {
    throw asPerpTradingError(error);
  }
}

const utc = (moment: string) => new Date(moment).toISOString();

/** The newest stored price of a feed. */
export async function latestPrice(pool: Database, feed: PriceFeed): Promise<Price> {
  const found = await read<Price | null>(pool, 'select market_data.price($1) as answer', [feed]);
  if (!found) throw new NoPriceYetError();
  return {
    feed: found.feed,
    price: found.price,
    at: utc(found.at),
    sources: found.sources,
    publishedAt: utc(found.publishedAt),
  };
}

/** A feed's prices over a range (the last day, when not given), at most 1,000 points. */
export async function priceHistory(
  pool: Database,
  feed: PriceFeed,
  range: HistoryRange = '1d',
): Promise<PriceHistory> {
  const found = await read<PriceHistory | null>(
    pool,
    'select market_data.price_history($1, $2) as answer',
    [feed, range],
  );
  if (!found) throw new NoPriceYetError();
  return { feed: found.feed, range: found.range, from: utc(found.from), points: found.points };
}

/** The asker a public quote imagines: nothing open on the perp, and money enough to pay for it. */
const ASKER = 'quote-asker';
const ENOUGH = '1000000000.000000';

/** A quote for opening a position: its size, fee and liquidation price at the price now. */
export async function perpQuote(
  pool: Database,
  input: PerpQuoteInput,
  source: PriceSource,
): Promise<PerpQuote> {
  const found = await read<Omit<StepState, 'trader'> | null>(
    pool,
    'select market_data.perp_quote_state($1) as answer',
    [input.id],
  );
  if (!found) throw new PerpTradingError('not_found', 'No such perp');
  const state: StepState = { ...found, trader: { accountId: ASKER, balance: ENOUGH } };
  const now = Date.parse(state.now);
  const priceAt = priceFor(state.perp, source);
  // The price an order placed now would be quoted at: the newest the step would apply.
  const point = priceAt(now);
  const bookAt =
    state.perp.priceAt === null ? Number.NEGATIVE_INFINITY : Date.parse(state.perp.priceAt);
  const quotedAt = Math.max(point?.ts ?? Number.NEGATIVE_INFINITY, bookAt);
  if (!Number.isFinite(quotedAt)) throw new PerpNotSetUpError();
  const params = {
    direction: input.direction,
    margin: decimal(micros(input.margin)),
    leverage: input.leverage,
    ...(input.maxFee === undefined ? {} : { maxFee: decimal(micros(input.maxFee)) }),
  };
  const plan = planStep(
    state,
    {
      action: 'open',
      requestId: randomUUID(),
      params,
      // Just before the price now, so the step fills at it, as an order placed then would.
      placedAt: new Date(quotedAt - 1).toISOString(),
    },
    priceAt,
    () => 'quoted-position',
  );
  if (!plan) throw new Error('An open always has a plan');
  if (plan.refusal) {
    throw new PerpTradingError('refused', plan.refusal.message, plan.refusal.code);
  }
  const opened = plan.events.find((event) => event.phase === 'trade' && event.kind === 'open');
  const position = plan.positions.find(
    (written) => written.accountId === ASKER && written.closeReason === null,
  );
  if (!opened || !position) throw new Error('An open that opened nothing');
  const price = plan.price?.price ?? state.perp.price;
  const at = plan.price?.at ?? state.perp.priceAt;
  if (price === null || at === null) throw new PerpNotSetUpError();
  const margin = micros(opened.margin);
  const fee = micros(opened.fee);
  return {
    perpId: input.id,
    direction: input.direction,
    margin: decimal(margin),
    leverage: input.leverage,
    size: position.size,
    fee: decimal(fee),
    cost: decimal(margin + fee),
    price,
    priceAt: utc(at),
    liquidationPrice: position.liquidationPrice,
    at: utc(state.now),
  };
}
