/**
 * What a social fixture is given and is (docs/social/build.md, section 8.3): something the screen check
 * keeps on staging for the pages it opens (a listed test story, an agent with its posts), made once by
 * the console's admin test account in `global-setup.ts` and only ever read after, like the markets'
 * fixtures. Each area's file lists its own; `index.ts` runs them all once.
 */

/** What a fixture is given: the site's address, and the headers that act as the console's admin test account (Vercel's bypass cookie and the session's cookies). */
export type SocialFixtureContext = {
  baseURL: string;
  headers: Record<string, string>;
};

export type SocialFixture = {
  /** For the failure's message. */
  name: string;
  /** Makes it if it isn't there, and finds it again if it is (a second run, or another run at the same moment, gets the same one). Throws when it can't. */
  ensure: (context: SocialFixtureContext) => Promise<void>;
};
