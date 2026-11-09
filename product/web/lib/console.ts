import { ConsoleError, isAdmin } from '@hrizzup/markets';
import { headers } from 'next/headers';
import { signedIn } from '@/lib/api/context.ts';
import { database } from '@/lib/db.ts';
import { consoleEnabled } from '@/lib/env.ts';

/**
 * Who may see the market console (PLAN.md step 1.7c): the signed-in account, if the database
 * says it's an admin (`admin.is_admin()`, which checks the admins table), the same check the
 * console's calls in the typed API make. Null for anyone else, signed in or not, and for everyone
 * on production until launch (`consoleEnabled`): the console's pages then answer "not found".
 */
export async function consoleAdmin(): Promise<{ id: string; email: string | null } | null> {
  if (!consoleEnabled()) return null;
  const user = await signedIn(new Headers(await headers()));
  if (!user) return null;
  const pool = database();
  if (!pool) return null;
  try {
    return (await isAdmin(pool, user.id)) ? { id: user.id, email: user.email } : null;
  } catch (error) {
    if (error instanceof ConsoleError && error.kind === 'not_admin') return null;
    throw error;
  }
}

/** A market's ID as the console's addresses carry it: a version 7 UUID, in lower case. */
export const MARKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
