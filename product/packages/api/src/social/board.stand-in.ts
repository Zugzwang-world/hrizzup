import * as examples from './board.examples.ts';
import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';

/** The board's and the stories' calls, answered with their examples. They are public reads: nobody need be signed in. */
export function boardStandIn(_access: StandInAccess) {
  return {
    social: {
      lists: api.social.lists.handler(() => examples.lists),
      board: api.social.board.handler(() => examples.storyPage),
      stories: {
        get: api.social.stories.get.handler(() => examples.storyDetail),
        updates: api.social.stories.updates.handler(() => examples.updatePage),
        posts: api.social.stories.posts.handler(() => examples.deskPage),
        brief: api.social.stories.brief.handler(() => examples.brief),
      },
    },
  };
}
