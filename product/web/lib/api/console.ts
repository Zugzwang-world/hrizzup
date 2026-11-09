import { DatabaseBusyError } from '@hrizzup/db';
import { ConsoleError, isAdmin } from '@hrizzup/markets';
import { ORPCError, os } from '@orpc/server';
import type { Pool } from 'pg';
import { database } from '@/lib/db.ts';
import { consoleEnabled } from '@/lib/env.ts';
import { type ApiContext, signedIn } from './context.ts';

/**
 * The market console's calls in the typed API (PLAN.md step 1.7c): admins only, through
 * `@hrizzup/markets`, whose database functions check the admins table themselves.
 *
 * Everyone else gets exactly what an address the API doesn't have gives ("No such call", 404),
 * whether they're signed in or not, and whatever they sent, so the console's calls can't even be
 * found. On production the console doesn't exist until launch, like the sign-in routes
 * (`consoleEnabled`), so there everyone gets it.
 */

/** What anyone but an admin gets from the console's calls: the API's own "No such call". */
export function noSuchCall(): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message: 'No such call' });
}

/** A refusal from the console's calls (or a busy database) as the API's answer. */
export function toApiError(error: unknown): unknown {
  if (error instanceof ConsoleError) {
    switch (error.kind) {
      case 'not_admin':
        return noSuchCall();
      case 'not_found':
        return new ORPCError('NOT_FOUND', { message: 'No such market' });
      case 'conflict':
        return new ORPCError('CONFLICT', { message: error.message });
      case 'invalid':
        return new ORPCError('BAD_REQUEST', { message: error.message });
    }
  }
  if (error instanceof DatabaseBusyError) {
    return new ORPCError('SERVICE_UNAVAILABLE', { message: 'The database is busy: try again' });
  }
  return error;
}

/** Runs one of the console's calls, turning its refusals into the API's answers. */
export async function consoleCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * The admin check, as oRPC middleware that wraps the console's subtree, so it runs before any
 * input is read. It asks the database itself (`admin.is_admin()`, as the app's own role), which
 * checks the admins table; each call then checks it again inside its own transaction. Where the
 * database isn't set up, nobody is an admin. The calls get the admin's account and the pool.
 */
export const asAdmin = os.$context<ApiContext>().middleware(async ({ context, next }) => {
  if (!consoleEnabled()) throw noSuchCall();
  const user = await signedIn(context.headers);
  if (!user) throw noSuchCall();
  const pool: Pool | null = database();
  if (!pool) throw noSuchCall();
  const admin = await consoleCall(() => isAdmin(pool, user.id));
  if (!admin) throw noSuchCall();
  return next({ context: { account: user.id, pool } });
});
