'use server';

import type { PerpRefusal, Refusal } from '@hrizzup/api';
import { ORPCError, ValidationError } from '@orpc/server';
import { revalidatePath } from 'next/cache';
import { serverApi } from '@/lib/api/server.ts';
import { money, percentToDecimal } from '@/lib/console-format.ts';
import { chance, plain, typedAmount, typedPercent, usd } from '@/lib/sandbox/format.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/**
 * The markets sandbox's buttons (/sandbox): each sends one of the typed API's own calls, in process
 * (lib/api/server.ts), as whoever is signed in, and answers in words what the books did or why they
 * refused. Like the sandbox's pages, they exist everywhere except production until launch.
 */

export type Answer = { ok: boolean; message: string };

const REFUSALS: Record<Refusal, string> = {
  market_not_open: "This market isn't taking bets.",
  market_closed: 'This market has closed.',
  insufficient_balance: "That's more than your balance.",
  not_enough_shares: 'You hold fewer shares than that.',
  price_limit: 'The price is at its limit (1% or 99%), or that sale is too small to price.',
  no_open_order: 'That order has already filled, been cancelled or run out.',
};

const PERP_REFUSALS: Record<PerpRefusal, string> = {
  trading_off: 'Trading on this perp is off (or closing only).',
  paused: "Trading is paused until the perp's next price.",
  stale_price: "The perp's price is out of date: trading resumes with the next one.",
  not_next_price: 'An order fills only at a price published after it was placed. Try again.',
  bad_request: "That amount or multiplier isn't valid.",
  leverage_too_high: "That's more than this perp allows.",
  fee_too_high: 'The fee is more than half the margin, or more than you accept.',
  size_fee_unpriceable: "The size fee can't be priced against an exhausted pool.",
  insufficient_balance: "That's more than your balance (the margin and the opening fee).",
  exposure_cap: "The other side can't back this much more right now.",
  no_position: 'There is no open position to close.',
  position_changed: 'The position changed since you looked. Try again.',
  insolvent: "The pools can't back this position right now.",
};

/** Why a call was refused, in words; anything we don't know how to say is thrown on. */
function explain(error: unknown): Answer {
  if (!(error instanceof ORPCError)) throw error;
  const data = error.data as { reason?: string; retryAfterSeconds?: number } | undefined;
  switch (error.code) {
    case 'UNAUTHORIZED':
      return { ok: false, message: 'Sign in first.' };
    case 'TOO_MANY_REQUESTS':
      return {
        ok: false,
        message: `Too many trades. Try again in ${data?.retryAfterSeconds ?? 30} seconds.`,
      };
    case 'REFUSED': {
      const reason = data?.reason ?? '';
      const words =
        REFUSALS[reason as Refusal] ?? PERP_REFUSALS[reason as PerpRefusal] ?? error.message;
      return { ok: false, message: words };
    }
    case 'SERVICE_UNAVAILABLE':
      return { ok: false, message: 'The database is busy. Try again in a moment.' };
    case 'CONFLICT':
      return {
        ok: false,
        message: 'That request was already used. Reload the page and try again.',
      };
    case 'NOT_FOUND':
      return { ok: false, message: 'There is no such market or perp.' };
    case 'BAD_REQUEST': {
      if (error.cause instanceof ValidationError) {
        const reasons = error.cause.issues.map((issue) => `${issue.message}.`);
        return { ok: false, message: [...new Set(reasons)].join(' ') };
      }
      return { ok: false, message: `${error.message}.` };
    }
    default:
      throw error;
  }
}

/** After the books change: every sandbox page shows the balance and positions as they now are. */
function showNewBooks() {
  revalidatePath('/sandbox', 'layout');
}

const unsigned = (decimal: string) => decimal.replace(/^-/, '');
const shares = (decimal: string) => plain(unsigned(decimal));
const side = (outcome: string) => (outcome === 'yes' ? 'Yes' : 'No');

// The markets ------------------------------------------------------------------------------------------

export type TradeRequest = {
  marketId: string;
  /** Chosen on the page when it opens, and sent again by a retry, so a trade is never made twice. */
  requestId: string;
  action: 'buy' | 'sell';
  outcome: 'yes' | 'no';
  /** A buy: the play money to spend, as typed. */
  amount: string;
  /** A sell: the shares to sell, as typed. */
  shares: string;
  /** A limit order's chance of Yes, as typed (1 to 99); empty for a market order. */
  limit: string;
  /** How long a limit order rests. */
  expires: 'never' | 'hour' | 'day';
};

const EXPIRY_MS = { hour: 3_600_000, day: 86_400_000 } as const;

/** Buys or sells in a market, now or as a limit order. */
export async function tradeAction(request: TradeRequest): Promise<Answer> {
  sandboxOnly();
  const common = { marketId: request.marketId, requestId: request.requestId };
  const outcome = request.outcome;
  try {
    if (request.action === 'sell') {
      const result = await serverApi.markets.trade({
        ...common,
        action: 'sell',
        outcome,
        shares: typedAmount(request.shares),
      });
      showNewBooks();
      return {
        ok: true,
        message: `Sold ${shares(result.shares)} ${side(outcome)} shares for ${money(unsigned(result.amount))}. The chance went from ${chance(result.probBefore)} to ${chance(result.probAfter)}.`,
      };
    }
    const typedLimit = typedPercent(request.limit);
    const limitProb = typedLimit === '' ? undefined : percentToDecimal(typedLimit);
    if (limitProb === null) {
      return { ok: false, message: 'Limit: a chance of Yes from 1 to 99.' };
    }
    const result = await serverApi.markets.trade({
      ...common,
      action: 'buy',
      outcome,
      amount: typedAmount(request.amount),
      ...(limitProb ? { limitProb } : {}),
      ...(limitProb && request.expires !== 'never'
        ? { expiresAt: new Date(Date.now() + EXPIRY_MS[request.expires]).toISOString() }
        : {}),
    });
    showNewBooks();
    if (result.status === 'resting') {
      return {
        ok: true,
        message: `Limit order resting: it buys ${side(outcome)} up to ${money(result.orderAmount ?? '0')} while the chance of Yes is ${outcome === 'yes' ? 'at most' : 'at least'} ${chance(result.limitProb ?? '0')}.`,
      };
    }
    const done = `Bought ${shares(result.shares)} ${side(outcome)} shares for ${money(result.amount)}. The chance went from ${chance(result.probBefore)} to ${chance(result.probAfter)}.`;
    return {
      ok: true,
      message:
        result.status === 'partly_filled'
          ? `${done} The rest of the limit order is resting.`
          : done,
    };
  } catch (error) {
    return explain(error);
  }
}

/** Cancels one of the person's own resting limit orders. */
export async function cancelOrderAction(request: {
  marketId: string;
  orderId: string;
  requestId: string;
}): Promise<Answer> {
  sandboxOnly();
  try {
    await serverApi.markets.cancelOrder(request);
    showNewBooks();
    return { ok: true, message: 'Order cancelled. Nothing was spent on what had not filled.' };
  } catch (error) {
    return explain(error);
  }
}

// The perp ---------------------------------------------------------------------------------------------

export type OpenRequest = {
  perpId: string;
  requestId: string;
  direction: 'long' | 'short';
  /** The play money to put behind the position, as typed. */
  margin: string;
  /** The multiplier, as typed (1 to the perp's most). */
  leverage: string;
};

const way = (direction: string) => (direction === 'long' ? 'Up' : 'Down');

/** Opens a position, or adds to one, at the next price (within seconds). */
export async function openPerpAction(request: OpenRequest): Promise<Answer> {
  sandboxOnly();
  try {
    const result = await serverApi.perps.open({
      perpId: request.perpId,
      requestId: request.requestId,
      direction: request.direction,
      margin: typedAmount(request.margin),
      leverage: request.leverage,
    });
    showNewBooks();
    const held = result.position;
    return {
      ok: true,
      message: held
        ? `${way(held.direction)} ${result.status === 'added' ? 'position grown' : 'position opened'} at ${usd(result.price)}: margin ${money(held.margin)}, size ${money(held.size)}, liquidated at ${usd(held.liquidationPrice)}. Paid ${money(result.fee)} in fees.`
        : `Filled at ${usd(result.price)}.`,
    };
  } catch (error) {
    return explain(error);
  }
}

/** Closes all of a position, at the next price (within seconds). */
export async function closePerpAction(request: {
  perpId: string;
  requestId: string;
  direction: 'long' | 'short';
}): Promise<Answer> {
  sandboxOnly();
  try {
    const result = await serverApi.perps.close({
      perpId: request.perpId,
      requestId: request.requestId,
      direction: request.direction,
      fraction: '1',
    });
    showNewBooks();
    return {
      ok: true,
      message: `${way(request.direction)} position closed at ${usd(result.price)}: paid out ${money(result.payout)}.`,
    };
  } catch (error) {
    return explain(error);
  }
}
