import type { Caching } from '@hrizzup/api';

/**
 * The moment (milliseconds since 1970) after which an answer must no longer be served from a kept
 * copy, as the call reported it while it was answering: the soonest of the moments it was told of. A
 * read that shows a market as open tells it when the market closes (`ClosingWatch` in
 * `@hrizzup/markets`), because a copy kept past that moment would show the market open after it
 * closed. The API's handler gives each call one (`router.ts`) and reads it back when it sets the
 * caching headers.
 */
export class EdgeExpiry {
  #at: number | null = null;

  /** The answer stops being true at `moment`; the soonest moment told is the one kept. */
  readonly endsAt = (moment: number): void => {
    if (Number.isNaN(moment)) return;
    if (this.#at === null || moment < this.#at) this.#at = moment;
  };

  /** The soonest moment told, or null when nothing was. */
  get at(): number | null {
    return this.#at;
  }
}

/**
 * How early, in seconds, a copy that must end at a moment is made to end before it, so that neither
 * the time the answer took to reach the edge nor the whole second a header can't split lets it show
 * the old answer after the moment.
 */
export const EXPIRY_MARGIN_SECONDS = 1;

/**
 * The response headers for a call's caching rule (blueprint section 14, "Caching in layers"),
 * set by the website's API handler from what the contract says.
 *
 * - **Public reads:** Vercel's edge keeps a copy for `edgeSeconds`, then serves it a little
 *   longer while it fetches a new one in the background (`stale-while-revalidate`), tagged so
 *   a change can clear every copy at once. Browsers and phones always ask again.
 * - **A public read that ends at a moment** (`endsAt`: a market shown as open closes then): the copy
 *   is never kept, fresh or stale, past that moment, however long the contract would keep it. Its
 *   fresh life shrinks to what is left (less the margin), and the stale time to what is left after
 *   that, so the edge asks again at the moment, never serving the old answer while it fetches.
 * - **Anything personal:** nobody keeps it (`private, no-store`). Vercel's edge never caches
 *   a request that carries a token (`Authorization`) or an answer that sets a cookie anyway.
 */
export function cacheHeaders(
  caching: Caching,
  endsAt: number | null = null,
  now: number = Date.now(),
): Record<string, string> {
  if (caching.kind === 'personal') return { 'Cache-Control': 'private, no-store' };
  let fresh = caching.edgeSeconds;
  let stale = caching.staleSeconds;
  if (endsAt !== null) {
    const left = Math.max(0, Math.floor((endsAt - now) / 1000) - EXPIRY_MARGIN_SECONDS);
    fresh = Math.min(fresh, left);
    stale = Math.min(stale, left - fresh);
  }
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': `max-age=${fresh}, stale-while-revalidate=${stale}`,
    'Vercel-Cache-Tag': caching.tags.join(','),
  };
}

/** Headers that would let anyone but the person keep an answer; removed from every error. */
export const SHARED_CACHE_HEADERS = [
  'Vercel-CDN-Cache-Control',
  'CDN-Cache-Control',
  'Vercel-Cache-Tag',
];
