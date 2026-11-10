import { randomUUID } from 'node:crypto';
import { type Transaction, transaction } from '@hrizzup/db';
import { STAND_IN_PRICE, STAND_IN_SEED_PATTERN, standInPrice } from '@hrizzup/market-engine';
import type { Pool } from 'pg';
import { type Plan, planStep, type StepRequest, type StepState } from './plan.ts';

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

/** The perp's price isn't set up here (no seed for the listed perp): trading answers "not set up". */
export class PerpNotSetUpError extends Error {
  constructor() {
    super("The perp's price isn't set up here");
    this.name = 'PerpNotSetUpError';
  }
}

/** Where one perp's price comes from: its walk, and a test perp's own seed. */
export type PerpPriceSource = Pick<StepState['perp'], 'seed' | 'standIn'>;

/** The stand-in price at a moment, for a perp: from its own seed, or the environment's. */
export function priceFor(perp: PerpPriceSource, source: PriceSource) {
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
  | { kind: 'too_soon'; nextAt: number };

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

  if (trade && state.perp.state === 'live' && state.perp.tradingMode !== 'halted') {
    // The next-price rule: a price published after the order was placed. A step of a perp with a
    // price can only fill at this moment's step; if that step started before the order was placed,
    // wait for the next (the database's clock, read under the lock, is what counts).
    const origin = Date.parse(state.perp.standIn.origin);
    const now = Date.parse(state.now);
    const stepStart = origin + Math.floor((now - origin) / STAND_IN_PRICE.intervalMs) * 5_000;
    if (stepStart <= Date.parse(request.placedAt)) {
      return { kind: 'too_soon', nextAt: stepStart + STAND_IN_PRICE.intervalMs };
    }
  }

  const plan: Plan | null = planStep(state, request, priceFor(state.perp, source), newId);
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
  constructor(readonly nextAt: number) {
    super('Too soon for the next price');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One step in its own transaction, as `account` (null for the scheduled jobs). A trade placed too
 * soon for this moment's price waits, outside any transaction, until the next 5-second step, and is
 * tried again (at most three times).
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
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(
        pool,
        async (tx) => {
          const answer = await stepIn(tx, perpId, request, source, options.newId);
          if (answer.kind === 'too_soon') throw new TooSoon(answer.nextAt);
          return answer;
        },
        // A step waits a little longer than a trade on a market for the perp's lock: a tick holds it
        // only while it applies a price.
        { account, lockTimeoutMs: 4_000 },
      );
    } catch (error) {
      if (!(error instanceof TooSoon) || attempt >= 3) throw error;
      // The database's clock and this server's may differ by a little: wait past the next step.
      await sleep(Math.min(Math.max(error.nextAt - clock(), 0), 5_000) + 150);
    }
  }
}
