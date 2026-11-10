import type { Environment } from '@hrizzup/core';

/**
 * Every page of the website, the address each check opens, and its speed budget. The screen
 * check, the journeys and the speed check all read this one list, and a unit test
 * (`pages.test.ts`, in Quick checks) fails when a page in `app/` has no entry here or an entry
 * names a page that no longer exists. So a new page can't skip its checks or its budget.
 */

/**
 * A page's speed budget (blueprint section 14, "Performance budgets"): Google's "good"
 * thresholds, measured as a mid-range Android phone on slow 4G (Lighthouse's mobile preset),
 * as the median of 5 runs. Changing a budget is a decision recorded in docs/setup.md.
 */
export type Budget = {
  /** Largest content on screen within this many milliseconds (Lighthouse's LCP). */
  loadMs: number;
  /**
   * How long the page keeps the phone too busy to answer a tap (Lighthouse's Total Blocking
   * Time, its lab stand-in for "every tap answered within 200 milliseconds").
   */
  blockingMs: number;
  /** Layout shift score (CLS): how much the page jumps while it loads. */
  layoutShift: number;
  /** Compressed code (JavaScript) on first load, from every site, embeds included. In KB of 1,024 bytes. */
  codeKB: number;
  /** Everything downloaded on first load, compressed, from every site. In KB of 1,024 bytes. */
  totalKB: number;
};

export const budgets = {
  /** The blueprint's starting numbers, for every page until a page needs its own. */
  standard: { loadMs: 2500, blockingMs: 200, layoutShift: 0.1, codeKB: 200, totalKB: 500 },
} as const satisfies Record<string, Budget>;

export type Page = {
  /** The page as `app/` names it: its address with dynamic parts in brackets, or `not-found`. */
  route: string;
  /** A short name for reports, screenshots and test titles. */
  name: string;
  /** The address the checks open (for a dynamic route, one real example). */
  path: string;
  /** The answer the page must give; 200 unless stated. */
  status?: number;
  budget: keyof typeof budgets;
  /** Environments where the page doesn't exist and answers 404 instead. */
  absentOn?: readonly Environment[];
};

/**
 * A test market the screen check keeps on staging for the console's market page: made, opened,
 * closed and settled once by the console's admin test account (global-setup.ts), and found
 * again by its ID on every run after.
 */
export const CONSOLE_FIXTURE_MARKET = '019a6c00-0000-7000-8000-000000000001';

/**
 * The Bitcoin perp (PLAN.md step 3.4a), which the migration that made the perp's books made on every
 * environment. Nothing in the checks changes it (the journeys change only each run's own test perps).
 */
export const BITCOIN_PERP = '01a1c501-ec40-78f6-87b6-3fb041143421';

/**
 * A test perp the screen check keeps on staging for the console's perp page: made once by the
 * console's admin test account (global-setup.ts), switched off, never traded, and changed by nobody
 * else, so its rule-change log only ever names that test account. (The Bitcoin perp's log names
 * whoever switches it, a real admin's own address, which must never reach a public screenshot.)
 */
export const CONSOLE_FIXTURE_PERP = '019a6c00-0000-7000-8000-000000000002';
export const FIXTURE_PERP_NAME =
  "Screen check: a test perp kept on staging for the console's screen check";

export const pages: readonly Page[] = [
  { route: '/', name: 'home', path: '/', budget: 'standard' },
  { route: '/privacy', name: 'privacy', path: '/privacy', budget: 'standard' },
  { route: '/terms', name: 'terms', path: '/terms', budget: 'standard' },
  {
    route: '/sign-in-test',
    name: 'sign-in-test',
    path: '/sign-in-test',
    budget: 'standard',
    absentOn: ['production'],
  },
  // The bot check the app shows in a small web view (PLAN.md step 1.6b): a sign-in route, so it
  // exists everywhere but production until launch, like the sign-in test page.
  {
    route: '/auth/app/bot-check',
    name: 'app-bot-check',
    path: '/auth/app/bot-check',
    budget: 'standard',
    absentOn: ['production'],
  },
  {
    route: 'not-found',
    name: 'not-found',
    path: '/this-page-does-not-exist',
    status: 404,
    budget: 'standard',
  },
  // The market console: admins only, so "not found" to every visitor, as everywhere on production
  // until launch. The screen check also opens it as the console's admin test account
  // (screens.spec.ts), and its journeys run it end to end (journeys/console.spec.ts).
  { route: '/console', name: 'console', path: '/console', status: 404, budget: 'standard' },
  {
    route: '/console/markets/new',
    name: 'console-new-market',
    path: '/console/markets/new',
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/markets/[id]',
    name: 'console-market',
    path: `/console/markets/${CONSOLE_FIXTURE_MARKET}`,
    status: 404,
    budget: 'standard',
  },
  // The perp's console page (PLAN.md step 3.4a): admins only, like every console page.
  {
    route: '/console/perps/[id]',
    name: 'console-perp',
    path: `/console/perps/${BITCOIN_PERP}`,
    status: 404,
    budget: 'standard',
  },
];

/** The pages that exist in an environment (staging, previews and this Mac have them all). */
export function pagesIn(environment: string | undefined): Page[] {
  return pages.filter((page) => !page.absentOn?.some((absent) => absent === environment));
}
