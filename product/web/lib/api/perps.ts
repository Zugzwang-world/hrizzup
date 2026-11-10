import { DatabaseBusyError } from '@hrizzup/db';
import { PerpNotSetUpError, PerpTradingError, type PriceSource, priceSource } from '@hrizzup/perps';
import { ORPCError } from '@orpc/server';

/**
 * The perp's calls for everyone in the website's API (PLAN.md step 3.4a), around `@hrizzup/perps`:
 * where its price comes from, and what each refusal answers. Who is signed in and the trades a minute
 * are the markets' (`trading.ts`): one limit for every trade a person makes.
 *
 * - Not signed in: 401. No such perp: 404.
 * - Refused (the perp switched off or closing only, more than its leverage, more than the balance,
 *   nothing to close, a part-close sized on a position that has since changed): 422 `REFUSED`, with
 *   the reason.
 * - A request ID already used for a different request: 409. Anything else not valid: 400.
 * - Over the trades a minute: 429. A busy database, or the perp's price not set up here: 503.
 */

/** The tag on every edge copy of the perps' public reads (the contract's `perps.list` and `perps.get`). */
export const PERPS_TAG = 'perps';

/**
 * Where the listed perp's stand-in price comes from: this environment's secret seed (Doppler,
 * `PERP_STAND_IN_SEED`), read when it's needed. Without one, or with one that isn't 16 lowercase
 * hexadecimal digits, the listed perp's price isn't set up here and its calls answer 503; a check
 * run's test perp always brings its own seed.
 */
export function perpSource(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PriceSource {
  return priceSource(env.PERP_STAND_IN_SEED);
}

/** A perp call's failure as the API's answer. */
export function perpApiError(error: unknown): unknown {
  if (error instanceof PerpTradingError) {
    switch (error.kind) {
      case 'not_found':
        return new ORPCError('NOT_FOUND', { status: 404, message: 'No such perp' });
      case 'conflict':
        return new ORPCError('CONFLICT', { status: 409, message: error.message });
      case 'invalid':
        return new ORPCError('BAD_REQUEST', { status: 400, message: error.message });
      case 'refused':
        return new ORPCError('REFUSED', {
          status: 422,
          message: error.message,
          data: { reason: error.reason ?? 'bad_request' },
        });
    }
  }
  if (error instanceof PerpNotSetUpError) {
    return new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: "The perp's price isn't set up here",
    });
  }
  if (error instanceof DatabaseBusyError) {
    return new ORPCError('SERVICE_UNAVAILABLE', {
      status: 503,
      message: 'The database is busy: try again',
    });
  }
  return error;
}

/** Runs one perp call, turning its refusals into the API's answers. */
export async function perpCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw perpApiError(error);
  }
}
