import { randomUUID } from 'node:crypto';
import { type Transaction, transaction } from '@hrizzup/db';
import {
  type OraclePoint,
  STAND_IN_PRICE,
  STAND_IN_SEED_PATTERN,
  standInPrice,
} from '@hrizzup/market-engine';
import type { Pool } from 'pg';
import {
  OWN_PRICE,
  type Plan,
  planStep,
  type StepRequest,
  type StepState,
  type StoredPoint,
} from './plan.ts';

/**
 * A perp step, as one database transaction (PLAN.md step 3.4a; blueprint section 5): the database
 * takes the perp's lock, so every trade, price and funding on one perp runs strictly one after
 * another; the server runs the perp's maths on the book as it stands, with the database's own time
 * passed in; and the price, the funding, the trade, every position, event and move are written
 * together, or nothing is. A trade carries its own request ID, so a retry answers with the first
 * answer and never trades twice.
 */

type Database = Pick<Pool, 'connect'>;

/** Where a perp's prices come from: its stand-in, from its own seed or the environment's secret one. */
export type PriceSource = {
  /** The environment's secret seed for the listed perp (Doppler, `PERP_STAND_IN_SEED`). */
  seed: string | undefined;
};

/**
 * The environment's seed as a price source. A seed that isn't 16 lowercase hexadecimal digits counts
 * as none, so a mistyped one leaves the listed perp "not set up" rather than failing every call.
 */
export function priceSource(seed: string | undefined): PriceSource {
  const given = seed?.trim();
  return { seed: given && STAND_IN_SEED_PATTERN.test(given) ? given : undefined };
}

/**
 * The perp's price isn't set up here (no seed for the listed perp on its stand-in; on our own price,
 * none stored yet): reads answer "not set up".
 */
export class PerpNotSetUpError extends Error {
  constructor() {
    super("The perp's price isn't set up here");
    this.name = 'PerpNotSetUpError';
  }
}

/**
 * No price came for an order in time (on our own price, none stored after it was placed): the
 * prices have stopped, so the order is refused, unfilled, and may be sent again.
 */
export class PriceUnavailableError extends Error {
  constructor() {
    super('The price is unavailable right now; trading resumes when it returns.');
    this.name = 'PriceUnavailableError';
  }
}

/**
 * Where one perp's price comes from: its feed, its stand-in's walk and a test perp's own seed, and
 * on our own price the newest stored one.
 */
export type PerpPriceSource = Pick<StepState['perp'], 'seed' | 'standIn'> & {
  feed?: string;
  point?: StoredPoint | null;
};

/** About how often our own price is stored: once an ask, every 5 seconds. */
export const OWN_PRICE_INTERVAL_MS = 5_000;
/** How long after the last stored price the next is usually in (an ask, and its answers). */
const OWN_PRICE_DUE_MS = OWN_PRICE_INTERVAL_MS + 400;
/** How often a waiting order looks again for our own next price, once it's due. */
const OWN_PRICE_POLL_MS = 500;
/**
 * How long an order on our own price waits for a price stored after it: two asks and more. Prices
 * are held for 30 seconds when the exchanges stop answering, so only a price store that has itself
 * stopped leaves an order waiting this long.
 */
export const OWN_PRICE_WAIT_MS = 15_000;

/** A stored price of ours as the engine reads a price; null before the first. */
export function storedPrice(point: StoredPoint | null | undefined): OraclePoint | null {
  if (!point) return null;
  const ts = Date.parse(point.at);
  const price = Number(point.price);
  if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) {
    throw new Error(`A stored price that isn't one: ${point.at}, ${point.price}`);
  }
  return { ts, price };
}

/** When an order placed at `placed` can next look for our own price, given the newest stored. */
export function ownPriceDueAt(newest: OraclePoint | null, placed: number, now: number): number {
  const due = newest ? newest.ts + OWN_PRICE_DUE_MS : placed + OWN_PRICE_POLL_MS;
  return Math.max(due, now + OWN_PRICE_POLL_MS);
}

/**
 * A perp's price at a moment: on our own price its newest stored one, whatever the moment; on its
 * stand-in, from its own seed or the environment's.
 */
export function priceFor(perp: PerpPriceSource, source: PriceSource) {
  if (perp.feed === OWN_PRICE) {
    const point = storedPrice(perp.point);
    if (!point) throw new PerpNotSetUpError();
    return (_moment: number): OraclePoint => point;
  }
  const seed = perp.seed ?? source.seed;
  if (!seed) throw new PerpNotSetUpError();
  const walk = {
    origin: Date.parse(perp.standIn.origin),
    startPrice: Number(perp.standIn.startPrice),
    annualVolatility: Number(perp.standIn.volatility),
  };
  return (moment: number) => standInPrice(seed, moment, walk);
}

/** What a step's transaction answered. */
export type StepAnswer =
  | { kind: 'applied'; result: Record<string, unknown> }
  /** A retried request: the books' first answer. */
  | { kind: 'replay'; result: Record<string, unknown> }
  /** A scheduled step found the perp busy with another step, which does the same work. */
  | { kind: 'busy' }
  /** Nothing to write: no new price, nothing due. */
  | { kind: 'nothing' }
  /** An order placed so recently that this moment's price isn't yet one published after it. */
  | { kind: 'too_soon'; nextAt: number; own: boolean };

/** One step's begin, plan and apply, inside a transaction already open. */
export async function stepIn(
  tx: Transaction,
  perpId: string,
  request: StepRequest,
  source: PriceSource,
  newId: () => string = randomUUID,
): Promise<StepAnswer> {
  const trade = request.action === 'open' || request.action === 'close';
  const { rows } = await tx.query<{ state: StepState & { replay?: unknown; busy?: boolean } }>(
    'select perps.begin_step($1, $2, $3, $4, $5) as state',
    [
      perpId,
      request.action,
      trade ? request.requestId : null,
      trade ? request.params : null,
      trade ? request.placedAt : null,
    ],
  );
  const state = rows[0]?.state;
  if (!state) throw new Error('begin_step answered nothing');
  if (state.replay) return { kind: 'replay', result: state.replay as Record<string, unknown> };
  if (state.busy) return { kind: 'busy' };

  const own = state.perp.feed === OWN_PRICE;
  const newest = own ? storedPrice(state.perp.point) : null;
  if (trade && state.perp.state === 'live' && state.perp.tradingMode !== 'halted') {
    // The next-price rule: a price published after the order was placed (the database's clock, read
    // under the lock, is what counts). On our own price: the newest stored, asked for after the
    // order; if there's none yet, wait for the next. On a stand-in: this moment's 5-second step; if
    // that step started before the order was placed, wait for the next.
    const now = Date.parse(state.now);
    const placed = Date.parse(request.placedAt);
    if (own) {
      if (!newest || newest.ts <= placed) {
        return { kind: 'too_soon', nextAt: ownPriceDueAt(newest, placed, now), own };
      }
    } else {
      const origin = Date.parse(state.perp.standIn.origin);
      const stepStart = origin + Math.floor((now - origin) / STAND_IN_PRICE.intervalMs) * 5_000;
      if (stepStart <= placed) {
        return { kind: 'too_soon', nextAt: stepStart + STAND_IN_PRICE.intervalMs, own };
      }
    }
  }

  const priceAt = own ? () => newest : priceFor(state.perp, source);
  const plan: Plan | null = planStep(state, request, priceAt, newId);
  if (!plan) return { kind: 'nothing' };
  const applied = await tx.query<{ result: Record<string, unknown> }>(
    'select perps.apply_step($1) as result',
    [plan],
  );
  const result = applied.rows[0]?.result;
  if (!result) throw new Error('apply_step answered nothing');
  return { kind: 'applied', result };
}

/** Rolls a too-soon step back, so nothing it read stays locked while it waits. */
class TooSoon extends Error {
  constructor(
    readonly nextAt: number,
    readonly own: boolean,
  ) {
    super('Too soon for the next price');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One step in its own transaction, as `account` (null for the scheduled jobs). A trade placed too
 * soon for this moment's price waits, outside any transaction, until the next 5-second step, and is
 * tried again (at most three times); on our own price, until the next price is stored, looking again
 * every half second, for at most `OWN_PRICE_WAIT_MS` after it was placed, then refused as
 * `PriceUnavailableError`.
 */
export async function runStep(
  pool: Database,
  account: string | null,
  perpId: string,
  request: StepRequest,
  source: PriceSource,
  options: { newId?: () => string; nowMs?: () => number } = {},
): Promise<Exclude<StepAnswer, { kind: 'too_soon' }>> {
  const clock = options.nowMs ?? Date.now;
  let last = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(
        pool,
        async (tx) => {
          const answer = await stepIn(tx, perpId, request, source, options.newId);
          if (answer.kind === 'too_soon') throw new TooSoon(answer.nextAt, answer.own);
          return answer;
        },
        // A step waits a little longer than a trade on a market for the perp's lock: a tick holds it
        // only while it applies a price.
        { account, lockTimeoutMs: 4_000 },
      );
    } catch (error) {
      if (!(error instanceof TooSoon)) throw error;
      if (error.own) {
        // Measured from when the order was placed, by the database's clock: this server's may
        // differ by a little, which only moves the end of the wait a little. Once it's over, one
        // last look (a copy of this request that filled meanwhile is answered as it filled), then
        // the refusal. Each look waits at least half a second, whatever the two clocks say.
        if (last) throw new PriceUnavailableError();
        const placed = 'placedAt' in request ? Date.parse(request.placedAt) : clock();
        last = clock() >= placed + OWN_PRICE_WAIT_MS;
        await sleep(
          Math.min(Math.max(error.nextAt - clock(), OWN_PRICE_POLL_MS), OWN_PRICE_DUE_MS),
        );
        continue;
      }
      if (attempt >= 3) throw error;
      // The database's clock and this server's may differ by a little: wait past the next step.
      await sleep(Math.min(Math.max(error.nextAt - clock(), 0), 5_000) + 150);
    }
  }
}
