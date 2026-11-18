import type { SocialLink } from './link.ts';

/**
 * The social sandbox's links for this area (R5): the board, which is also where the sandbox's one
 * "Social" link leads (the first link of the joined menu). Marked for its own address only: a story's
 * page and every other area's pages sit under `/sandbox/social`, and none of them is the board.
 */
export const boardLinks: readonly SocialLink[] = [{ href: '/sandbox/social', text: 'Board' }];
