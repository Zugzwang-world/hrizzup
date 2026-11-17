import { api } from './implementer.ts';
import type { StandInAccess } from './kit.ts';
import * as examples from './replies.examples.ts';

/** Replies', upvotes' and the preview's calls, answered with their examples. */
export function repliesStandIn(access: StandInAccess) {
  return {
    social: {
      posts: {
        replies: api.social.posts.replies.handler(() => examples.replyPage),
      },
      me: {
        reply: api.social.me.reply.handler(() => {
          access.signedIn();
          return examples.reply;
        }),
        upvote: api.social.me.upvote.handler(() => {
          access.signedIn();
          return examples.upvoted;
        }),
        inbox: api.social.me.inbox.handler(() => {
          access.signedIn();
          return examples.inboxPage;
        }),
        preview: api.social.me.preview.handler(() => {
          access.signedIn();
          return examples.postPreview;
        }),
      },
    },
  };
}
