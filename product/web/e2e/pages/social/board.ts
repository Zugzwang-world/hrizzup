import { BOARD_FIXTURE_STORY } from '../../fixtures/social/board.ts';
import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's board area (R5) the checks open, with their speed budgets: the board,
 * and the story page on the board fixture (`fixtures/social/board.ts`: an unlisted test story with three
 * updates and an empty desk). Both are on staging, previews and this Mac only, like the sandbox.
 */
export const boardPages: readonly Page[] = [
  {
    route: '/sandbox/social',
    name: 'social-board',
    path: '/sandbox/social',
    budget: 'standard',
    absentOn: ['production'],
  },
  {
    route: '/sandbox/social/stories/[id]',
    name: 'social-story',
    path: `/sandbox/social/stories/${BOARD_FIXTURE_STORY}`,
    budget: 'standard',
    absentOn: ['production'],
  },
];
