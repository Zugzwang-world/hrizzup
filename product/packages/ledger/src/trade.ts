import { randomUUID } from 'node:crypto';
import { type Transaction, transaction } from '@hrizzup/db';
import type { Pool } from 'pg';
import {
  type MarketState,
  type Outcome,
  type Plan,
  paramsOf,
  planTrade,
  type Refusal,
  type TradeRequest,
} from './plan.ts';

/**
 * A trade, as one database transaction (PLAN.md step 1.7b; blueprint section 5): the database
 * takes the market's lock, so trades on one market run strictly one after another; the server
 * runs Manifold's maths on the market as it stands, with the database's time passed in (always
 * the database's own clock: nobody can choose it); and the trade, its fills, the positions, the
 * pool and the moves are written together, or nothing is. Each request carries its own ID: a
 * retry returns the first result and never trades twice.
 *
 * This is what the typed API's trade call (step 1.7d) runs, for the signed-in account.
 */

/** The answer to a trade request, as the database stored it. */
export type TradeResult =
  | {
      status: 'filled' | 'partly_filled' | 'resting';
      request_id: string;
      market_id: string;
      trade_id: string;
      number: number;
      outcome: Outcome;
      /** Money paid (or, when negative, money back), as exact decimal text. */
      amount: string;
      /** Shares bought (or, when negative, sold), as exact decimal text. */
      shares: string;
      order_amount: string | null;
      limit_prob: string | null;
      prob_before: string;
      prob_after: string;
      /** The trader's balance afterwards. */
      balance: string;
      position: { yes: string; no: string };
      at: string;
    }
  | { status: 'cancelled'; request_id: string; market_id: string; order_id: string }
  | { status: 'refused'; reason: Refusal; request_id: string; market_id: string };

/**
 * One trade for `account` (the signed-in Supabase user), in its own transaction, as the app's
 * role, tried again if the database asks. Throws TradeInputError for a malformed request, and
 * the database's own error when the market or the account doesn't exist.
 */
export function trade(
  pool: Pick<Pool, 'connect'>,
  account: string,
  request: TradeRequest,
): Promise<TradeResult> {
  const params = paramsOf(request); // Checks the request before it reaches the database.
  const tradeId = randomUUID();
  return transaction(pool, (tx) => tradeIn(tx, request, params, tradeId), { account });
}

/** The trade's steps, inside one transaction. */
async function tradeIn(
  tx: Transaction,
  request: TradeRequest,
  params: Record<string, string>,
  tradeId: string,
): Promise<TradeResult> {
  const begun = await tx.query<{ state: MarketState & { replay?: TradeResult } }>(
    'select markets.begin_trade($1, $2, $3, $4) as state',
    [request.requestId, request.marketId, request.action, params],
  );
  const state = begun.rows[0]?.state;
  if (!state) throw new Error('begin_trade answered nothing');
  if (state.replay) return state.replay;

  const plan: Plan =
    request.action === 'cancel_order'
      ? {
          request_id: request.requestId.toLowerCase(),
          market_id: request.marketId.toLowerCase(),
          action: 'cancel_order',
          params, // The order to withdraw is the request's own orderId.
        }
      : planTrade(request, state, tradeId);
  const applied = await tx.query<{ result: TradeResult }>(
    'select markets.apply_trade($1) as result',
    [plan],
  );
  const result = applied.rows[0]?.result;
  if (!result) throw new Error('apply_trade answered nothing');
  return result;
}
