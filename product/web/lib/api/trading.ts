import { DatabaseBusyError } from '@hrizzup/db';
import { TradingError } from '@hrizzup/markets';
import { ORPCError } from '@orpc/server';
import type { Pool } from 'pg';
import { database } from '@/lib/db.ts';
import { type SignedIn, signedIn } from './context.ts';
import { allowTrade } from './rate-limit.ts';

/**
 * The markets' calls for everyone in the website's API (PLAN.md step 1.7d), around `@hrizzup/markets`:
 * who is signed in, each person's trades per minute, and what each refusal answers.
 *
 * - Not signed in: 401. No such market (or a draft, which only admins see): 404.
 * - Refused by the books (an amount over the balance, shares over those held, a market not open or
 *   closed, a price at its limit, no such open order): 422 `REFUSED`, with the reason.
 * - A request ID already used for a different request: 409. A page cursor that isn't the person's,
 *   or an expiry the database's clock has already passed: 400.
 * - Over the trades a minute: 429 `TOO_MANY_REQUESTS`, with `Retry-After`. A busy database: 503.
 */

/** A trading call's failure as the API's answer. */
export function tradingApiError(error: unknown): unknown {
  if (error instanceof TradingError) {
    switch (error.kind) {
      case 'not_found':
        return new ORPCError('NOT_FOUND', { status: 404, message: 'No such market' });
      case 'conflict':
        return new ORPCError('CONFLICT', { status: 409, message: error.message });
      case 'invalid':
        return new ORPCError('BAD_REQUEST', { status: 400, message: error.message });
      case 'refused':
        return new ORPCError('REFUSED', {
          status: 422,
          message: error.message,
          data: { reason: error.reason },
        });
    }
  }
  if (error instanceof DatabaseBusyError) {
    return new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'The database is busy: try again',
    });
  }
  return error;
}

/** Runs one trading call, turning its refusals into the API's answers. */
export async function tradingCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw tradingApiError(error);
  }
}

/** The database pool, or "not set up here" (503) where it isn't. */
export function tradingPool(): Pick<Pool, 'connect'> {
  const pool = database();
  if (!pool) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'Trading is not set up here',
    });
  }
  return pool;
}

/** The signed-in person making a personal call, or "not signed in" (401). */
export async function person(headers: Headers): Promise<SignedIn> {
  const user = await signedIn(headers);
  if (!user) throw new ORPCError('UNAUTHORIZED', { status: 401, message: 'Not signed in' });
  return user;
}

/**
 * Counts one trading call against the person's trades a minute, or refuses it (429) with the seconds
 * to wait, also sent as `Retry-After`.
 */
export async function withinTradeLimit(account: string, responseHeaders?: Headers): Promise<void> {
  const allowance = await allowTrade(account);
  if (allowance.allowed) return;
  responseHeaders?.set('Retry-After', String(allowance.retryAfterSeconds));
  throw new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: 'Too many trades: try again in a moment',
    data: { retryAfterSeconds: allowance.retryAfterSeconds },
  });
}
