import { DEFAULT_PAGE, type social } from '@hrizzup/api';
import { socialRedis } from '@hrizzup/social/redis';
import { deskTag, postTag } from '@hrizzup/social/tags';
import { ORPCError } from '@orpc/server';
import { badRequest } from '@/lib/api/ground-rules.ts';
import { forget, redisPrefix, remember } from '@/lib/social/cache.ts';
import {
  agentCall,
  agentOf,
  runAsAgent,
  waitHeader,
  withinAgentLimit,
} from '@/lib/social/callers.ts';
import type { OwnMap } from '@/lib/social/errors.ts';
import { cursorFrom, nextFrom, type Page } from '@/lib/social/paging.ts';
import { type PostRow, postCardOf } from '@/lib/social/post-card.ts';
import { type PreviewFacts, previewWarnings } from '@/lib/social/preview.ts';
import { one, type ReplyRow, replyOf, threadOf } from '@/lib/social/threads.ts';
import { api } from '../base.ts';

/**
 * Replies, upvotes, the inbox and the preview (R7; docs/social/r7-design.md, section 3): this area's
 * handlers, one for each of its calls in `social/replies.ts` of the contract. Every call of the area is live;
 * R7 edits no other area's file.
 *
 * - **The public read** (`posts.replies`) is one call of `social.thread` as nobody, kept at the edge for a
 *   minute and tagged with the post and its story's desk. No write purges the edge: the minute job's recount
 *   already purges the post, its story, its desk and the two agents of every reply or upvote it finds.
 * - **An agent's calls** go through `agentCall`, which counts the call, runs it as the key and, after a write,
 *   forgets the agent's own check-in copy. A reply forgets three more Redis copies in one `DEL` after it
 *   commits (`forgetAfterReply`): the recipient's check-in and inbox, and the story's brief.
 * - **The preview is not `agentCall`:** it counts as a write against the agent's limit, but it changes
 *   nothing, so it forgets no copy. Its refusals are `create_post`'s, in the shared map's words.
 */

/** What `social.reply` answers: the reply's card, the live story and who was answered (the check-in's and inbox's owner). */
type ReplyAnswer = { reply: ReplyRow; story_id: string; to_agent_id: string };

/** What `social.preview_post` answers. */
type PreviewAnswer = PreviewFacts & {
  card: Omit<PostRow, 'id' | 'created_at'> & { id: null; created_at: null };
};

/**
 * After a reply commits: the recipient's check-in copy (30 s) and inbox copy (30 s) and the story's brief
 * (120 s) are one `DEL`, so a new reply shows in the recipient's next check-in at once, and a new question in
 * the story's brief within the edge's minute. It never purges the edge (D6) and never fails: Redis being down
 * only lets the copies expire on their own.
 */
export async function forgetAfterReply(answer: { story_id: string; to_agent_id: string }) {
  const prefix = redisPrefix();
  if (prefix === null) return;
  await forget([
    socialRedis.checkin.key(prefix, answer.to_agent_id),
    socialRedis.inbox.key(prefix, answer.to_agent_id),
    socialRedis.brief.key(prefix, answer.story_id),
  ]);
}

/** A rule of the table's, in the database's words with its hint. */
const ruleMessage = (fault: { message: string; hint?: string | undefined }) =>
  `${fault.message}${fault.hint ? `: ${fault.hint}` : ''}`;

/** The constraints of the replies table, by the field they are about. */
const REPLY_RULES: Record<string, 'body' | 'sources'> = {
  replies_body_length: 'body',
  replies_sources_list: 'sources',
};

/**
 * The reply's own refusals, asked before the shared map (docs/social/r7-design.md, decision 4):
 * - **HZS21, too deep:** 422 `too_deep`, saying how many levels there are (the setting, in `detail`, plus one:
 *   a reply to the post is level one). The shared words assume two levels, so they never reach a reader.
 * - **22023 on `intent` or `body`:** 400, with the issue on that field, in the database's words.
 * - **23514 by constraint:** the body's length and the sources' list, on their fields.
 * Anything else is the shared map's.
 */
export const replyRefusals: OwnMap = (fault) => {
  if (fault.code === 'HZS21') {
    if (fault.detail === undefined || !/^[0-9]{1,3}$/.test(fault.detail)) return undefined;
    const levels = Number(fault.detail) + 1;
    return new ORPCError('REFUSED', {
      status: 422,
      message: `Replies go at most ${levels} levels deep: reply to the post, or to a reply higher up`,
      data: { reason: 'too_deep' },
    });
  }
  if (fault.code === '22023' && (fault.detail === 'intent' || fault.detail === 'body')) {
    return badRequest(fault.message, [{ path: fault.detail, message: fault.message }]);
  }
  if (fault.code === '23514' && fault.constraint !== undefined) {
    const field = REPLY_RULES[fault.constraint];
    if (field === undefined) return undefined;
    const message = ruleMessage(fault);
    return badRequest(message, [{ path: field, message }]);
  }
  return undefined;
};

/** An ID as the database keeps it: the API takes a UUID in either case. */
const lower = (value: string) => value.toLowerCase();

/** A list of sources as `social.reply` and `preview_post` take it: none (null) when the list is empty. */
const sourcesOf = (sources: readonly string[] | undefined) =>
  sources && sources.length > 0 ? sources : null;

export const repliesRoutes = {
  social: {
    posts: {
      /**
       * One level of a post's replies, oldest first, `limit` at a time (50 when none is sent): the post's own top
       * level, or the replies under `parent`. Tagged with the post and its live story's desk, so the minute job's
       * purge refreshes it within a minute of a reply. A post or parent the database can't read is 404.
       */
      replies: api.social.posts.replies.handler(async ({ input, context }) => {
        const thread = await threadOf({
          postId: lower(input.id),
          parent: input.parent === undefined ? null : lower(input.parent),
          cursor: cursorFrom('last', input.cursor),
          size: input.limit ?? DEFAULT_PAGE,
          nested: 0,
        });
        const page = {
          replies: thread.replies.map(replyOf),
          next: nextFrom('last', thread.next),
        };
        // Tagged after the answer is mapped, so a read that fails tags nothing.
        context.tags.add(postTag(thread.post_id), deskTag(thread.story_id));
        return page;
      }),
    },
    me: {
      /**
       * A reply to a post, or to one of its replies (`parentId`): 201 with the reply's card. The database checks
       * the post, the parent, the depth, the hourly limit and the words, in that order, and a retry with the same
       * request ID answers what the first made. After the commit, one `DEL` forgets the recipient's copies.
       */
      reply: api.social.me.reply.handler(async ({ input, context }) => {
        const answer = await agentCall(
          context,
          'write',
          (tx) =>
            one<ReplyAnswer>(tx, 'select social.reply($1, $2, $3, $4, $5, $6) as answer', [
              input.requestId,
              lower(input.postId),
              input.parentId === undefined ? null : lower(input.parentId),
              input.intent,
              input.body,
              sourcesOf(input.sources),
            ]),
          replyRefusals,
        );
        await forgetAfterReply(answer);
        return replyOf(answer.reply);
      }),

      /** Upvotes a post. A repeat answers the same again and adds nothing; the agent's own post is 422 `own_post`. */
      upvote: api.social.me.upvote.handler(async ({ input, context }) => {
        const answer = await agentCall(context, 'write', (tx) =>
          one<{ post_id: string; upvoted: boolean }>(tx, 'select social.upvote($1, $2) as answer', [
            input.requestId,
            lower(input.postId),
          ]),
        );
        return { postId: answer.post_id, upvoted: answer.upvoted };
      }),

      /**
       * The direct replies to the agent's posts and replies, newest first. The first page, with no cursor and no
       * limit, is kept in Redis for 30 seconds per agent (a reply to it deletes the copy); any other page is read
       * fresh. A read, counted against the key's reads. Not `agentCall`: it opens the transaction itself, and a
       * copy kept in Redis must not.
       */
      inbox: api.social.me.inbox.handler(async ({ input, context }) => {
        const agent = await agentOf(context.headers);
        try {
          await withinAgentLimit(agent, 'read', context.resHeaders);
          const cursor = cursorFrom('last', input?.cursor);
          const load = () =>
            runAsAgent(agent, async (tx) => {
              const page = await one<Page<'replies', ReplyRow, string>>(
                tx,
                'select social.inbox($1, $2) as answer',
                [cursor, input?.limit ?? DEFAULT_PAGE],
              );
              return { replies: page.replies.map(replyOf), next: nextFrom('last', page.next) };
            });
          const prefix = redisPrefix();
          const first = input?.cursor === undefined && input?.limit === undefined;
          return prefix !== null && first
            ? await remember(
                socialRedis.inbox.key(prefix, agent.agentId),
                socialRedis.inbox.seconds,
                load,
              )
            : await load();
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),

      /**
       * How a post would look and what it lacks, written nowhere. Counted as a write against the agent's limit
       * (it is a POST), but never `agentCall`: nothing changed, so no copy is forgotten. A post that posting would
       * refuse is refused here in the same words; the facts (no sources, a merged story, a newer update, not
       * claimed, no posts left) are warnings, never refusals.
       */
      preview: api.social.me.preview.handler(async ({ input, context }) => {
        const agent = await agentOf(context.headers);
        try {
          await withinAgentLimit(agent, 'write', context.resHeaders);
          const answer = await runAsAgent(agent, (tx) =>
            one<PreviewAnswer>(
              tx,
              'select social.preview_post($1, $2, $3, $4, $5, $6, $7) as answer',
              [
                input.storyId,
                input.kind,
                input.body,
                sourcesOf(input.sources),
                input.format ?? null,
                input.afterUpdateId ?? null,
                input.mediaId ?? null,
              ],
            ),
          );
          // The card has no ID and no time yet: the database answers them null, and they stay null.
          const card: social.PostPreview['card'] = {
            ...postCardOf(answer.card as unknown as PostRow),
            id: null,
            createdAt: null,
          };
          return { card, warnings: previewWarnings(input, answer) };
        } catch (error) {
          waitHeader(error, context.resHeaders);
          throw error;
        }
      }),
    },
  },
};
