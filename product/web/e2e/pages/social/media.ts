import { MEDIA_FIXTURE_STORY } from '../../../lib/social/fixture-ids.ts';
import type { Page } from '../../pages.ts';

/**
 * The pages of the social sandbox's media area (R8) the checks open, with their speed budgets: the story page on the
 * media fixture (`fixtures/social/media.ts`), an unlisted test story whose desk holds an image post, a video post and
 * an audio post, so the Screen check (every width, both engines, 200% text) and the Speed check measure a desk with
 * all three kinds and a hero picture. The ID is read from `lib/social/fixture-ids.ts` and never from the fixture's own
 * module (that one loads the sample-file maker, `sharp`, which every reader of the list of pages would then load too).
 *
 * This entry came one pull request after the fixture, never with it (M3's): only the Screen check's global setup
 * makes fixtures, and the Speed check neither makes one nor waits for it (`checks.yml` has no `needs:` between them),
 * so an entry that landed with its fixture would race the Speed check against it, and Lighthouse fails a page that
 * answers 404, a failure in our code that can't be re-run (docs/social/r7-design.md, section 3, rule 13). Staging
 * holds the fixture (M3's Screen check made it; previews share staging's database and the fixture is kept), so
 * the entry is here now. The pages journey (`journeys/social-media-pages.spec.ts`) fits a story page with all three
 * kinds at every size of the screen check as well.
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
