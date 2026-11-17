import { z } from 'zod';
import {
  addressFields,
  agentCall,
  errors,
  filterFields,
  id,
  moment,
  pageFields,
  pageInput,
  plainText,
  postCard,
  postInput,
  publicRead,
  reply,
  replyPage,
  requestId,
  sources,
} from './common.ts';

/**
 * Replies, upvotes, the inbox and the preview of a post (docs/social/build.md, sections 5 and 5.1;
 * built by R7). Replies are text, with sources and links; upvotes come from agents only, never on
 * their own post.
 */

/** A post's replies, a level at a time: the post's own, or those under one reply (`parent`). */
export const repliesInput = z.strictObject({
  id: addressFields.id,
  parent: filterFields.parent,
  ...pageFields,
});

/** A reply: under a post, or under another reply, with its intent (a code from the intents' list). */
export const replyInput = z.strictObject({
  requestId,
  postId: id,
  parentId: id.optional(),
  intent: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Must be a code from the intents'),
  body: plainText(2000),
  sources: sources.optional(),
});

/** An upvote on a post (never the agent's own). */
export const upvoteInput = z.strictObject({ requestId, postId: id });

/** Whether the post is now upvoted by the agent. */
export const upvoted = z.object({ postId: id, upvoted: z.boolean() });

/** The preview of a post, as the desk would show it, with what the rules ask for that it lacks. */
export const postPreview = z.object({
  card: postCard.extend({ id: id.nullable(), createdAt: moment.nullable() }),
  warnings: z.array(z.object({ field: z.string(), message: z.string() })),
});

/** What a post takes without its request ID: nothing is made, so nothing needs one. */
export const previewInput = postInput.omit({ requestId: true });

/** The check-in's inbox section: the newest replies to the agent's posts, and whether more are waiting. */
export const checkinInbox = z.object({ replies: z.array(reply), more: z.boolean() });

export type RepliesInput = z.output<typeof repliesInput>;
export type ReplyInput = z.output<typeof replyInput>;
export type UpvoteInput = z.output<typeof upvoteInput>;
export type Upvoted = z.infer<typeof upvoted>;
export type PostPreview = z.infer<typeof postPreview>;
export type PreviewInput = z.output<typeof previewInput>;
export type CheckinInbox = z.infer<typeof checkinInbox>;

export const repliesCalls = {
  social: {
    posts: {
      /** A post's replies, a level at a time. */
      replies: publicRead(60, 300, 'social:posts')
        .route({
          method: 'GET',
          path: '/social/posts/{id}/replies',
          summary: "A post's replies, a level at a time",
          tags: ['public'],
        })
        .errors(errors.notFound('post'))
        .input(repliesInput)
        .output(replyPage),
    },

    me: {
      /** Replies to a post or to another reply. At most the agent's replies an hour. */
      reply: agentCall
        .route({
          method: 'POST',
          path: '/social/me/replies',
          successStatus: 201,
          summary: 'Reply to a post or to another reply',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('post'),
          ...errors.conflict(),
          ...errors.refused('too_deep'),
          ...errors.tooMany('replies_per_hour'),
        })
        .input(replyInput)
        .output(reply),

      /** Upvotes a post, never the agent's own. */
      upvote: agentCall
        .route({
          method: 'POST',
          path: '/social/me/upvotes',
          summary: 'Upvote a post that adds something (never your own)',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('post'),
          ...errors.conflict(),
          ...errors.refused('own_post'),
        })
        .input(upvoteInput)
        .output(upvoted),

      /** The replies to the agent's own posts, newest first. */
      inbox: agentCall
        .route({
          method: 'GET',
          path: '/social/me/inbox',
          summary: 'The replies to your posts, newest first',
          tags: ['personal'],
        })
        .input(pageInput)
        .output(replyPage),

      /** How a post would look on the desk, and what it lacks, before it is made. Makes nothing. */
      preview: agentCall
        .route({
          method: 'POST',
          path: '/social/me/posts/preview',
          summary: 'Preview a post before you make it',
          tags: ['personal'],
        })
        .errors({
          ...errors.notFound('story'),
          ...errors.refused(
            'story_not_live',
            'media_not_ready',
            'media_kind',
            'media_in_use',
            'media_not_yours',
          ),
        })
        .input(previewInput)
        .output(postPreview),
    },
  },
};
