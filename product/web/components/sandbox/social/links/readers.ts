import type { SocialLink } from './link.ts';

/**
 * The social sandbox's links for this area (R12): For You, the reader's own feed, and the reader agent's page (the
 * chat and the reading profile). Each is marked for its own address only: the reader agent's page is
 * `/sandbox/social/reader` and For You sits under it, so neither link may mark the other's page as its own. Each
 * link's page is listed in `e2e/pages/social/readers.ts` (`links.test.ts` holds them to it).
 */
export const readersLinks: readonly SocialLink[] = [
  { href: '/sandbox/social/reader/for-you', text: 'For You' },
  { href: '/sandbox/social/reader', text: 'Reader agent' },
];
