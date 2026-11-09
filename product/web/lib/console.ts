import { headers } from 'next/headers';
import { consoleAdmin as adminOf, type ConsoleAdmin } from '@/lib/api/console.ts';

/**
 * Who may see the market console (PLAN.md step 1.7c): the signed-in account, if the database
 * says it's an admin. The same check as the console's calls in the typed API, from the same
 * place (lib/api/console.ts), so the two can't drift apart: null for anyone else, signed in or
 * not, for everyone on production until launch, and whenever the check itself fails, so a
 * failure looks exactly like a refusal. The console's pages and forms then answer "not found".
 */
export async function consoleAdmin(): Promise<ConsoleAdmin | null> {
  return adminOf(new Headers(await headers()));
}

/** A market's ID as the console's addresses carry it: a version 7 UUID, in lower case. */
export const MARKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
