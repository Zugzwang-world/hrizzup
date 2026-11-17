import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The board and the stories (R5): this area's handlers, one for each of its calls in `social/board.ts` of the
 * contract. Stubs until R5 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R5 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const boardRoutes = {
  social: {
    lists: api.social.lists.handler(notBuilt),
    board: api.social.board.handler(notBuilt),
    stories: {
      get: api.social.stories.get.handler(notBuilt),
      updates: api.social.stories.updates.handler(notBuilt),
      posts: api.social.stories.posts.handler(notBuilt),
      brief: api.social.stories.brief.handler(notBuilt),
    },
  },
};
