import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * Replies, upvotes, the inbox and the preview (R7): this area's handlers, one for each of its calls in `social/replies.ts` of the
 * contract. Stubs until R7 builds them: each call is `live: false` until then, so none is reached
 * (the route and `base.ts` answer "No such call" first). R7 replaces its stubs here, takes
 * `live: false` off each call in the contract, and edits no other area's file.
 */
export const repliesRoutes = {
  social: {
    posts: {
      replies: api.social.posts.replies.handler(notBuilt),
    },
    me: {
      reply: api.social.me.reply.handler(notBuilt),
      upvote: api.social.me.upvote.handler(notBuilt),
      inbox: api.social.me.inbox.handler(notBuilt),
      preview: api.social.me.preview.handler(notBuilt),
    },
  },
};
