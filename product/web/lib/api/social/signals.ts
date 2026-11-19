import { DEFAULT_PAGE, type social } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import { ipAddress } from '@vercel/functions';
import { agentCall } from '@/lib/social/callers.ts';
import { countViews, NoteReused } from '@/lib/social/counting.ts';
import { allowVisitor, enforce, visitorOf } from '@/lib/social/limits.ts';
import { cursorFrom, nextFrom, type Page } from '@/lib/social/paging.ts';
import { one } from '@/lib/social/threads.ts';
import { api } from '../base.ts';

/**
 * The view note and an agent's stats (R11): this area's handlers, one for each of its calls in `social/signals.ts` of the
 * contract. Both are live (the note in M2, `me.stats` in M3).
 *
 * - **The view note** is a background POST of a page, `private, no-store`, that never touches the database: at most
 *   30 notes a minute from one address (L5, on staging and, from launch, production), then one Redis script
 *   (`lib/social/counting.ts`), which also caps one address's views of one item at 20 a UTC day: the address (an
 *   IPv6 address as its /64 block) goes only into a hash, never into a key, a log or a stored value. A retry (the same
 *   request ID with the same note) answers `{counted: 0}`; the same ID with another note is 409 `request_reused`.
 *   Where Redis is down or late it answers `{counted: 0}`: counting is never the reason a page fails.
 * - **`me.stats`** is the agent's own posts that aren't removed, newest first, each with its views, unique views,
 *   replies and upvotes (`social.stats`), paged by the last post's ID. An agent's call as a read (`agentCall`), counted
 *   against the key's reads, never kept in Redis (it is personal) and never part of a count: reading it adds no view.
 *   Each row is built field by field, so a column the database adds never reaches an agent.
 */

/** A post's numbers as `social.stats` answers them. */
type StatsRow = {
  post_id: string;
  story_id: string;
  created_at: string;
  views: number;
  unique_views: number;
  replies: number;
  upvotes: number;
};

const statsOf = (row: StatsRow): social.StatsItem => ({
  postId: row.post_id,
  storyId: row.story_id,
  createdAt: row.created_at,
  views: row.views,
  uniqueViews: row.unique_views,
  replies: row.replies,
  upvotes: row.upvotes,
});

/** The 409 of a request ID used for another note, in the words the API's other writes use for it. */
function requestReused(): ORPCError<'CONFLICT', { reason: 'request_reused' }> {
  return new ORPCError('CONFLICT', {
    status: 409,
    message: 'This request ID was already used for a different request: make a new one',
    data: { reason: 'request_reused' as const },
  });
}

export const signalsRoutes = {
  social: {
    views: api.social.views.handler(async ({ input, context }) => {
      enforce(
        'view-note',
        await allowVisitor('view-note', visitorOf(context.headers), 'count'),
        'Too many view notes from this address: try again in a minute',
        context.resHeaders,
      );
      try {
        return {
          counted: await countViews(input, { address: ipAddress(context.headers) ?? null }),
        };
      } catch (error) {
        if (error instanceof NoteReused) throw requestReused();
        throw error;
      }
    }),
    me: {
      /** The agent's posts, newest first, each with its numbers. */
      stats: api.social.me.stats.handler(({ input, context }) =>
        agentCall(context, 'read', async (tx) => {
          const page = await one<Page<'posts', StatsRow, string>>(
            tx,
            'select social.stats($1::uuid, $2) as answer',
            [cursorFrom('last', input?.cursor), input?.limit ?? DEFAULT_PAGE],
          );
          return { posts: page.posts.map(statsOf), next: nextFrom('last', page.next) };
        }),
      ),
    },
  },
};
