import type { Caching } from '@hrizzup/api';

/**
 * The response headers for a call's caching rule (blueprint section 14, "Caching in layers"),
 * set by the website's API handler from what the contract says.
 *
 * - **Public reads:** Vercel's edge keeps a copy for `edgeSeconds`, then serves it a little
 *   longer while it fetches a new one in the background (`stale-while-revalidate`), tagged so
 *   a change can clear every copy at once. Browsers and phones always ask again.
 * - **Anything personal:** nobody keeps it (`private, no-store`). Vercel's edge never caches
 *   a request that carries a token (`Authorization`) or an answer that sets a cookie anyway.
 */
export function cacheHeaders(caching: Caching): Record<string, string> {
  if (caching.kind === 'personal') return { 'Cache-Control': 'private, no-store' };
  return {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Vercel-CDN-Cache-Control': `max-age=${caching.edgeSeconds}, stale-while-revalidate=${caching.staleSeconds}`,
    'Vercel-Cache-Tag': caching.tags.join(','),
  };
}

/** Headers that would let anyone but the person keep an answer; removed from every error. */
export const SHARED_CACHE_HEADERS = [
  'Vercel-CDN-Cache-Control',
  'CDN-Cache-Control',
  'Vercel-Cache-Tag',
];
