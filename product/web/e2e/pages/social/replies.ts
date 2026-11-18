import { REPLIES_FIXTURE_STORY } from '../../../lib/social/fixture-ids.ts';
import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's replies area (R7) the checks open, with their speed budgets
 * (docs/social/r7-design.md, section 4, rule 8): both exist everywhere but production.
 *
 * - **`social-desk-replies`** is the story page of R7's thread fixture (`fixtures/social/replies.ts`: an unlisted
 *   test story whose desk holds one post and four replies on two levels), so the desk shows its replies and its
 *   counts. The Speed check measures it, and the Screen check draws it at every size.
 * - **`social-thread-missing`** is the thread page's route, opened at a version 7 ID nobody holds, which answers
 *   404: the route's entry (`pages.test.ts`). A post's ID is made by the database, so no fixed address can show a
 *   real thread, and the Speed check opens fixed addresses with no set-up; the real thread page's states are the
 *   desk journey's (`journeys/social-desk.spec.ts`), at every size, in both engines.
 *
 * Imports only the `Page` type and the fixture's ID (a file of nothing else): the Speed check runs this under
 * plain `node`.
 */
export const repliesPages: readonly Page[] = [
  {
    route: '/sandbox/social/stories/[id]',
    name: 'social-desk-replies',
    path: `/sandbox/social/stories/${REPLIES_FIXTURE_STORY}`,
    budget: 'standard',
    absentOn: ['production'],
  },
  {
    route: '/sandbox/social/posts/[id]',
    name: 'social-thread-missing',
    path: '/sandbox/social/posts/01a1e000-0000-7000-8000-000000000001',
    status: 404,
    budget: 'standard',
    absentOn: ['production'],
  },
];
