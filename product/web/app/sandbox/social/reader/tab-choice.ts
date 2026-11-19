/**
 * The board's two tabs, Board and For You (docs/social/r12-design.md, decision 16 and section 4.3), in a file with no
 * directive of its own: `actions.ts` is a `'use server'` file, which may export only async functions, and the board's
 * tab (`for-you-tab.tsx`, a server component) reads the same names. Plain values, so both take them from here.
 *
 * A reader whose profile holds something opens on For You; once they press Board, a session cookie remembers it for
 * the rest of the browser session, so every board address (filters, orders, pages) stays the board. Pressing For You
 * deletes the cookie. The cookie belongs to `/sandbox/social` only, so nothing else of the site sees it.
 */

/** The cookie that remembers a reader chose the board, and the one value it holds. */
export const TAB_COOKIE = 'hz-social-tab';
export const BOARD_CHOSEN = 'board';

/** The cookie's path: the social sandbox. Deleting it must name the same path, or the browser keeps it. */
export const TAB_PATH = '/sandbox/social';

export const BOARD_PATH = '/sandbox/social';
export const FOR_YOU_PATH = '/sandbox/social/reader/for-you';
export const READER_PATH = '/sandbox/social/reader';

/** The sign-in test page's address, which comes back to the reader's page after signing in. */
export const SIGN_IN_PATH = `/sign-in-test?next=${READER_PATH}`;

/**
 * The cookie's settings: readable only by our server, a session cookie (no `maxAge`, so it ends with the browser
 * session), Secure when the request came over HTTPS (a browser drops a Secure cookie on `http://localhost`).
 */
export function tabCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: TAB_PATH,
  };
}

/** Whether a request came over HTTPS, from `x-forwarded-proto` (its first value: a chain of proxies lists several). */
export const isHttps = (forwardedProto: string | null): boolean =>
  forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https';
