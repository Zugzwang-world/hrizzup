import { BOARD_FIXTURE_STORY, BOARD_FIXTURE_TITLE } from '../../fixtures/social/board.ts';
import type { Page } from '../../pages.ts';

/**
 * R5's console pages for social, under `/console/social`, for the checks (docs/social/build.md, section 8.3):
 * admins only, so each answers 404 to everyone else, like every console page, and the screen check also
 * opens each as the console's admin test account (`consoleSocialAdminChecks`, below).
 * `e2e/pages.ts` spreads the list in next to the market console's own entries (not into `socialPages`, which
 * holds the sandbox's pages only). Imports only the `Page` type from `../../pages.ts`, never a value.
 *
 * - **Everyone but an admin gets the "not found" page,** which is what the Speed check measures for each entry
 *   (as it does for the market console's pages: it opens every page signed out, and an entry that answers
 *   404 is measured as that page). The admin's own view is checked for fit by the Screen check, below.
 * - **The two lists of people are opened past their last page.** The Screen check's screenshots are kept as
 *   a download of the check run, and a repository that is public makes them public, so the invites list
 *   (every invite's email and note) and the agents list (each agent's invite email) are opened at a page that
 *   holds nothing, by construction (`EMPTY_PAGE_CURSOR`, `lib/social/console-forms.ts`: the lists page by the
 *   last ID shown, and no row has that one). Their rows' layout is checked by the console journey
 *   (`journeys/social-console-pages.spec.ts`), which keeps no screenshot.
 * - **The story's page is the board fixture's** (`fixtures/social/board.ts`): an unlisted test story with three
 *   updates, which the checks keep on staging and which names no one.
 */

/** A page past the last of an invites or agents list, which holds nothing: the lists page by the ID of the last row shown. */
const EMPTY_PAGE = '?after=00000000-0000-7000-8000-000000000000';

export const consoleSocialPages: readonly (Page & { status: 404 })[] = [
  {
    route: '/console/social',
    name: 'console-social',
    path: '/console/social',
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/social/invites',
    name: 'console-social-invites',
    path: `/console/social/invites${EMPTY_PAGE}`,
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/social/stories',
    name: 'console-social-stories',
    path: '/console/social/stories',
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/social/stories/[id]',
    name: 'console-social-story',
    path: `/console/social/stories/${BOARD_FIXTURE_STORY}`,
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/social/settings',
    name: 'console-social-settings',
    path: '/console/social/settings',
    status: 404,
    budget: 'standard',
  },
  {
    route: '/console/social/agents',
    name: 'console-social-agents',
    path: `/console/social/agents${EMPTY_PAGE}`,
    status: 404,
    budget: 'standard',
  },
];

/**
 * The same pages as the console's admin sees them, one entry each for the screen check (`screens.spec.ts`):
 * its report name (the page's name and `-admin`), its address, and the heading the page must show.
 */
export const consoleSocialAdminChecks: readonly { name: string; path: string; admin: string }[] = [
  { name: 'console-social-admin', path: '/console/social', admin: 'Social console' },
  {
    name: 'console-social-invites-admin',
    path: `/console/social/invites${EMPTY_PAGE}`,
    admin: 'Invites',
  },
  { name: 'console-social-stories-admin', path: '/console/social/stories', admin: 'Stories' },
  {
    name: 'console-social-story-admin',
    path: `/console/social/stories/${BOARD_FIXTURE_STORY}`,
    admin: BOARD_FIXTURE_TITLE,
  },
  { name: 'console-social-settings-admin', path: '/console/social/settings', admin: 'Settings' },
  {
    name: 'console-social-agents-admin',
    path: `/console/social/agents${EMPTY_PAGE}`,
    admin: 'Agents',
  },
];
