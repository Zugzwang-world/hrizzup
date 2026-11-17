import type { Caching } from '@hrizzup/api';
import { checkedTags, isValidTag } from '@hrizzup/social/tags';

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

/** Vercel keeps at most this many tags on one response. */
export const MAX_TAGS_IN_ALL = 128;

/**
 * The tags of what an answer shows (a story, a desk, a post, an agent: `@hrizzup/social/tags`), told
 * by the call while it answers (`context.tags.add(storyTag(id))`), to join the contract's own tags
 * in the response's `Vercel-Cache-Tag` (docs/social/build.md, D6 and section 6). Each is checked
 * as it is added, so a tag Vercel would refuse (a comma would split it in two) stops the call that
 * made it, not the edge.
 */
export class EdgeTags {
  #tags: string[] = [];

  /** The answer shows these things: each tag once, in the order told. */
  readonly add = (...tags: string[]): void => {
    for (const tag of tags) {
      if (!isValidTag(tag)) {
        throw new TypeError(
          `${JSON.stringify(tag)} is not a tag Vercel takes: printable ASCII with no comma or space, under 256 bytes`,
        );
      }
      if (!this.#tags.includes(tag)) this.#tags.push(tag);
    }
  };

  /** The tags told so far, in order. */
  get list(): readonly string[] {
    return this.#tags;
  }
}

/**
 * A response's tags: the contract's, then those the call told, each once. Every tag is one Vercel
 * takes (a comma is refused, never split), a response carries at most 128 in all, and at most 8 of
 * social's own (`social:…`, D6), so a mistake in a handler throws here instead of reaching the
 * edge as a header Vercel would cut short.
 */
export function edgeTags(contract: readonly string[], told: readonly string[] = []): string[] {
  const all = [...new Set([...contract, ...told])];
  for (const tag of all) {
    if (!isValidTag(tag)) {
      throw new TypeError(`${JSON.stringify(tag)} is not a tag Vercel takes: no comma, no space`);
    }
  }
  if (all.length > MAX_TAGS_IN_ALL) {
    throw new RangeError(`A response carries at most ${MAX_TAGS_IN_ALL} tags, not ${all.length}`);
  }
  checkedTags(all.filter((tag) => tag.startsWith('social:')));
  return all;
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
 * - **A public read's tags** are the contract's, then the call's own for what it shows (`told`).
 * - **Anything personal:** nobody keeps it (`private, no-store`). Vercel's edge never caches
 *   a request that carries a token (`Authorization`) or an answer that sets a cookie anyway.
 */
export function cacheHeaders(
  caching: Caching,
  endsAt: number | null = null,
  now: number = Date.now(),
  told: readonly string[] = [],
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
    'Vercel-Cache-Tag': edgeTags(caching.tags, told).join(','),
  };
}

/** Headers that would let anyone but the person keep an answer; removed from every error. */
export const SHARED_CACHE_HEADERS = [
  'Vercel-CDN-Cache-Control',
  'CDN-Cache-Control',
  'Vercel-Cache-Tag',
];
