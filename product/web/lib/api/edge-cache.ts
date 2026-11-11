import { invalidateByTag, waitUntil } from '@vercel/functions';

/**
 * Clearing Vercel's edge copies of the typed API's public reads the moment their data changes
 * (blueprint section 14, "Caching in layers"). Each public read tags its answer (`Vercel-Cache-Tag`,
 * from its contract entry); a change marks every copy with the tag stale, so the next visitor still
 * gets an answer at once while the edge fetches a new one in the background (Vercel's
 * `invalidateByTag`, which it recommends over deleting outright: a deleted copy sends every waiting
 * visitor to the server at once). Vercel scopes tags to the project and the environment that clears
 * them, so a change clears the copies where it was made; previews share staging's database, so a
 * change made on one leaves the other's copies to age out by their own edge life (a minute at most).
 *
 * Off Vercel (this Mac, the tests) there's no edge, and this does nothing.
 */

/** The tag on every page of the market list (the contract's `markets.list`). */
export const MARKETS_TAG = 'markets';

/**
 * The tag on the edge copies of each market's activity (the contract's `markets.book`,
 * `markets.trades` and `markets.quote`), cleared whenever an order rests, fills or is cancelled, even
 * when the price doesn't move; and, with the list's, when a trade or the console changes a market.
 */
export const MARKET_ACTIVITY_TAG = 'market-activity';

/** How long a call waits for the edge to take the change before answering anyway. */
const WAIT_MS = 1500;

/**
 * Marks every edge copy carrying these tags stale. Waits briefly, so whoever made the change and asks
 * again at once is served by the new copy's refresh; never fails the call that made the change (the
 * copies then age out by their own edge life, a minute at most), and finishes in the background.
 */
export async function refreshEdge(
  tags: readonly string[],
  invalidate: (tags: string[]) => Promise<void> = invalidateByTag,
): Promise<void> {
  let purge: Promise<void>;
  try {
    purge = invalidate([...tags]).catch(() => {});
  } catch {
    return;
  }
  waitUntil(purge);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    purge,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}
