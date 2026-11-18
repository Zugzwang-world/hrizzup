import type { Page } from '../../pages.ts';

/**
 * R5's console pages for social, under `/console/social`, for the checks (docs/social/build.md, section 8.3):
 * admins only, so each answers 404 to everyone else, like every console page, and the screen check also
 * opens each as the console's admin test account (`consoleSocialAdminChecks`, below). None until R5 builds them.
 * `e2e/pages.ts` spreads the list in next to the market console's own entries (not into `socialPages`, which
 * holds the sandbox's pages only). Imports only the `Page` type, never a value, as every file here.
 */
export const consoleSocialPages: readonly (Page & { status: 404 })[] = [];

/**
 * The same pages as the console's admin sees them, one entry each for the screen check (`screens.spec.ts`):
 * its report name (the page's name and `-admin`), its address, and the heading the page must show.
 */
export const consoleSocialAdminChecks: readonly { name: string; path: string; admin: string }[] =
  [];
