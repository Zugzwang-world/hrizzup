import { ORPCError } from '@orpc/server';
import { notFound } from 'next/navigation';
import { consoleAdmin } from '@/lib/console.ts';

/**
 * What every page of the social console (`app/console/social/**`) does first and how it reads a list, in the one
 * place: the second check that the visitor is an admin (the proxy has already given anyone else the site's own
 * "not found" page, `proxy.ts`), "not found" when a call is no call here, and a list's page, which keeps to the
 * first page when the address's cursor is not one.
 */

/** The first thing every page does: anyone but an admin gets "not found". */
export async function adminOrNotFound(): Promise<void> {
  if (!(await consoleAdmin())) notFound();
}

/** A call's answer; "No such call" (social is off here, or the call isn't live) is "not found", anything else is thrown as it came. */
export async function orNotFound<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (
      error instanceof ORPCError &&
      error.code === 'NOT_FOUND' &&
      error.message === 'No such call'
    ) {
      notFound();
    }
    throw error;
  }
}

/** A query value as one text, the first when it is repeated. */
export function textOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A page of a list: read from the address's cursor, or from the start when there is none, or when the API
 * says the cursor is not one (`dropped`, so the page can say so in a line).
 */
export async function pageOf<T>(
  read: (input: { limit: number; cursor?: string }) => Promise<T>,
  limit: number,
  cursor: string | undefined,
): Promise<{ page: T; dropped: boolean }> {
  if (cursor) {
    try {
      return { page: await orNotFound(read({ limit, cursor })), dropped: false };
    } catch (error) {
      if (!(error instanceof ORPCError) || error.code !== 'BAD_REQUEST') throw error;
    }
  }
  return { page: await orNotFound(read({ limit })), dropped: cursor !== undefined };
}
