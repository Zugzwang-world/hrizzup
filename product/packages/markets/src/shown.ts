import type { ListedMarket } from '@hrizzup/api';

/**
 * What the public reads show of a market's state (the Product chat, 11 November 2026).
 *
 * A market's stored state stays `open` until the console closes it, but its trades stop at its closing
 * time (the books refuse any trade placed at or after `closes_at`, by the database's clock). A read
 * that said `open` after that would invite exactly the trade that gets refused, so every read shows a
 * market that is `open` and past its closing time as `closed`, without waiting for the console. The
 * moment is the same one the trade checks: at the closing time itself, a market is closed. Anything
 * else is shown as stored; the console, which acts on the stored state, still reads it as stored.
 */

/**
 * Told by a read, for each market it shows as open, the moment (milliseconds since 1970) that market
 * stops being open. The website's API uses it to keep an edge copy of the answer from outliving that
 * moment (`web/lib/api/caching.ts`).
 */
export type ClosingWatch = (closesAt: number) => void;

/** The state to show for a market stored as `state` that closes at `closesAt`, at `now`. */
export function shownState<S extends string>(
  state: S,
  closesAt: string,
  now: number = Date.now(),
): S | 'closed' {
  return state === 'open' && now >= Date.parse(closesAt) ? 'closed' : state;
}

/**
 * A market as the list and one market's read give it, with the state to show. An open market that
 * still has time is reported to `watch`, which is told when it will stop being open.
 */
export function shownMarket(
  listed: ListedMarket,
  now: number = Date.now(),
  watch?: ClosingWatch,
): ListedMarket {
  if (listed.market.state !== 'open') return listed;
  const closesAt = Date.parse(listed.market.closes_at);
  if (now >= closesAt) return { ...listed, market: { ...listed.market, state: 'closed' } };
  watch?.(closesAt);
  return listed;
}
