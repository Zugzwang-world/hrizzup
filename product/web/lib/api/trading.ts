import type { KeyScope } from '@hrizzup/api';
import { asKey, DatabaseBusyError, errorCode } from '@hrizzup/db';
import { TradingError } from '@hrizzup/markets';
import { ORPCError } from '@orpc/server';
import type { Pool } from 'pg';
import { database } from '@/lib/db.ts';
import { apiKeysEnabled } from '@/lib/env.ts';
import { type SignedIn, signedIn } from './context.ts';
import { credentialOf } from './credential.ts';
import { findKey } from './keys.ts';
import { allowKeyRead, allowTrade } from './rate-limit.ts';

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
 * - A bot's API key (step 3.5a): one that isn't valid (never made, revoked, or production's,
 *   before launch) is 401; a read-only key on a trading call is 403 `FORBIDDEN`, and so is any key
 *   on the keys' own calls, which need a signed-in session; more than its personal reads a minute
 *   is 429.
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

/** Who is making a personal call, and with which API key, if any. */
export type Person = SignedIn & { key: { id: string; scope: KeyScope } | null };

/**
 * What a call needs of whoever makes it: `session`, someone signed in on the website or in the app
 * (the keys' own calls); `read`, that or any live API key (personal reads); `trade`, that or a
 * trading key (trading and the perp).
 */
export type Need = 'session' | 'read' | 'trade';

/** How the database's stamp on a trade request begins its refusal of a key (keys.stamp_request). */
const KEY_REFUSED = "This key can't trade";

const notSignedIn = () => new ORPCError('UNAUTHORIZED', { status: 401, message: 'Not signed in' });
const badKey = (message: string) => new ORPCError('UNAUTHORIZED', { status: 401, message });

/**
 * The person making a personal call: from their session, or from a bot's API key when the request
 * carries one (and then only from the key). Refused as the call's need says (see above).
 */
export async function person(headers: Headers, need: Need = 'session'): Promise<Person> {
  const credential = credentialOf(headers);
  if (credential.kind !== 'key' && credential.kind !== 'bad-key') {
    const user = await signedIn(headers);
    if (!user) throw notSignedIn();
    return { ...user, key: null };
  }
  if (need === 'session') {
    throw new ORPCError('FORBIDDEN', {
      status: 403,
      message: 'Keys are made and revoked only when signed in on the website, never with a key',
    });
  }
  if (!apiKeysEnabled()) throw badKey('API keys work only on staging until launch');
  const found =
    credential.kind === 'key'
      ? await tradingCall(() => findKey(tradingPool(), credential.text))
      : null;
  if (!found) throw badKey("This API key isn't valid: it may have been revoked");
  if (need === 'trade' && found.scope !== 'trade') {
    throw new ORPCError('FORBIDDEN', {
      status: 403,
      message: 'This key is read-only: only a trading key may trade',
    });
  }
  return {
    id: found.userId,
    email: null,
    name: null,
    provider: null,
    testAccount: false,
    key: { id: found.id, scope: found.scope },
  };
}

/**
 * Runs a call's work as the request its person's API key signed, if one did, so the database stamps
 * each trade with the key and refuses one the key may no longer place (revoked a moment ago): that
 * refusal answers as a key that isn't valid (401).
 */
export async function asPerson<T>(who: Person, work: () => Promise<T>): Promise<T> {
  if (!who.key) return work();
  try {
    return await asKey(who.key.id, work);
  } catch (error) {
    // Only the database's own refusal of the key (keys.stamp_request), never another permission error.
    if (
      errorCode(error) === '42501' &&
      error instanceof Error &&
      error.message.startsWith(KEY_REFUSED)
    ) {
      throw badKey("This API key isn't valid: it may have been revoked");
    }
    throw error;
  }
}

/**
 * Counts one personal read against an API key's reads a minute, or refuses it (429) with the
 * seconds to wait, also sent as `Retry-After`. The website's and the app's own reads aren't counted.
 */
export async function withinReadLimit(who: Person, responseHeaders?: Headers): Promise<void> {
  if (!who.key) return;
  const allowance = await allowKeyRead(who.key.id);
  if (allowance.allowed) return;
  responseHeaders?.set('Retry-After', String(allowance.retryAfterSeconds));
  throw new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: 'Too many reads with this key: try again in a moment',
    data: { retryAfterSeconds: allowance.retryAfterSeconds },
  });
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
