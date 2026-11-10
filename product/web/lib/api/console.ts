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
        // The database's own words: "No such market", or "No such perp".
        return new ORPCError('NOT_FOUND', {
          message: /^No such (market|perp)$/.test(error.message) ? error.message : 'No such market',
        });
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

/** The admin making a console call: their account, and the database pool to run it on. */
export type ConsoleAdmin = { account: string; pool: Pick<Pool, 'connect'> };

/**
 * Whether the request comes from an admin: the console exists here (`consoleEnabled`), someone is
 * signed in, and the database itself says the account is an admin (`admin.is_admin()`, as the
 * app's own role, which checks the admins table). Where the database isn't set up, or the check
 * fails for any reason, the answer is no: a failure must look exactly like "not an admin", or it
 * would tell a stranger the console's calls exist. (An admin then gets "not found" until the
 * database answers again.)
 */
export async function consoleAdmin(headers: Headers): Promise<ConsoleAdmin | null> {
  if (!consoleEnabled()) return null;
  try {
    const user = await signedIn(headers);
    if (!user) return null;
    const pool = database();
    if (!pool) return null;
    return (await isAdmin(pool, user.id)) ? { account: user.id, pool } : null;
  } catch {
    return null;
  }
}

/**
 * Whether an address under /api/v1 is one of the console's (`/admin/…`), however its slashes are
 * doubled (`/api/v1//admin/…`), so no way of writing one can slip past the check.
 */
export function isConsoleAddress(url: string): boolean {
  const path = new URL(url).pathname.replace(/\/{2,}/g, '/');
  return path === '/api/v1/admin' || path.startsWith('/api/v1/admin/');
}

/**
 * The admin check, as oRPC middleware that wraps the console's subtree, so it runs before any
 * input is read: for the website's own server code, which calls the API in process
 * (lib/api/server.ts). Over HTTP, the API's route checks first, before the request is even
 * decoded, and hands the admin on (`consoleAdmin` in the context), so the database is asked once.
 * Each call's database function checks the admins table again inside its own transaction.
 */
export const asAdmin = os.$context<ApiContext>().middleware(async ({ context, next }) => {
  const admin =
    context.consoleAdmin === undefined ? await consoleAdmin(context.headers) : context.consoleAdmin;
  if (!admin) throw noSuchCall();
  return next({ context: admin });
});
