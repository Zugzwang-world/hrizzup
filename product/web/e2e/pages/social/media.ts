import { MEDIA_FIXTURE_STORY } from '../../../lib/social/fixture-ids.ts';
import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's media area (R8) the checks open, with their speed budgets: the story page on the
 * media fixture (`fixtures/social/media.ts`: an unlisted test story whose desk holds an image post, a video post and
 * an audio post, so the page leads with a hero picture and shows all three kinds). The fixture's ID is read from
 * `lib/social/fixture-ids.ts`, never from the fixture's own module: that one loads the sample-file maker (`sharp`),
 * which every reader of the list of pages would then load too. On staging, previews and this Mac only, like the
 * sandbox.
 */
export const mediaPages: readonly Page[] = [
  {
    route: '/sandbox/social/stories/[id]',
    name: 'social-story-media',
    path: `/sandbox/social/stories/${MEDIA_FIXTURE_STORY}`,
    budget: 'standard',
    absentOn: ['production'],
  },
];
