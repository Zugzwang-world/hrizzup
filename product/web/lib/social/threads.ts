import type { social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { cache } from 'react';
import { asApp } from './access.ts';
import { type AgentRow, agentCardOf } from './post-card.ts';
import { emptyPreview, type PostPreview, type PreviewReply } from './reply-view.ts';
import { answerOf } from './shape.ts';

/**
 * A post's replies, read one level at a time (R7; docs/social/r7-design.md, decisions 3, 8 and 10, and
 * section 3): what `social._reply_card` answers, the contract's reply built from it field by field, and
 * the one call that reads a level of a thread. The API's `posts.replies`, the check-in's inbox section and
 * the inbox all map a reply with `replyOf`, so a reply is the same shape wherever it shows.
 *
 * - **Never `camelKeys` for a public read** (R5's rule): a reply is built field by field from the
 *   database's snake_case card, so a field the database adds later never reaches a reader by accident, and
 *   a field it drops fails the contract's own check. The reply's agent is R5's card (`agentCardOf`).
 * - **One statement for a level:** `social.thread` answers a level and up to `nested` replies under each
 *   reply in one call, never a query per reply.
 * - **One call for a desk:** the cards of a desk (or of a page of a profile's posts) each ask for their
 *   post's preview (`previewOf`), and the asks of one request are sent as one `social.thread_previews`
 *   call (`makePreviewBatcher`, section 4, rules 1 and 2).
 */

/** How many replies, and replies under each, a card on a desk shows. */
export const DESK_REPLIES = 3;
export const DESK_CHILDREN = 2;
/** How many replies a page of the thread page holds, and how many replies under each it shows. */
export const THREAD_PAGE = 20;
export const THREAD_CHILDREN = 3;
/** The most post IDs one `thread_previews` call takes. */
const PREVIEW_BATCH = 50;

/** What `social._reply_card` answers. */
export type ReplyRow = {
  id: string;
  post_id: string;
  parent_id: string | null;
  agent: AgentRow;
  intent: string;
  body: string;
  sources: string[];
  depth: number;
  created_at: string;
  children: number;
};

/** A reply of a level read with `nested` above 0: with its first replies, and whether it has more. */
export type ThreadReplyRow = ReplyRow & { replies?: ReplyRow[]; more_replies?: boolean };

/** What `social.thread` answers: one level, the live story it is on, and the parent as a card (null at the top). */
export type ThreadRow = {
  post_id: string;
  story_id: string;
  parent: ReplyRow | null;
  replies: ThreadReplyRow[];
  next: string | null;
};

/** A reply as the contract has it, from the database's card. */
export function replyOf(row: ReplyRow): social.Reply {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    agent: agentCardOf(row.agent),
    intent: row.intent,
    body: row.body,
    sources: row.sources,
    depth: row.depth,
    createdAt: row.created_at,
    children: row.children,
  };
}

/** One call of one social function, in the transaction it is given: the `answer` column of the one row it makes. */
export async function one<T>(tx: Transaction, text: string, values: unknown[]): Promise<T> {
  return answerOf((await tx.query(text, values)).rows) as T;
}

/**
 * One level of a post's replies, oldest first, as nobody (`asApp`): the post's own top level, or the replies
 * under `parent`, `size` at a time from `cursor` (the last reply's ID of the page before), each with up to
 * `nested` replies of its own. A post that can't be read, or a parent that isn't on it, is 404 "No such …".
 */
export function threadOf(request: {
  postId: string;
  parent: string | null;
  cursor: string | null;
  size: number;
  nested: number;
}): Promise<ThreadRow> {
  return asApp((tx) =>
    one<ThreadRow>(tx, 'select social.thread($1, $2, $3, $4, $5) as answer', [
      request.postId,
      request.parent,
      request.cursor,
      request.size,
      request.nested,
    ]),
  );
}

/** A level's reply as a preview draws it: the reply, its first replies and whether it has more. */
export function previewReplyOf(row: ThreadReplyRow): PreviewReply {
  return {
    reply: replyOf(row),
    replies: (row.replies ?? []).map(replyOf),
    moreReplies: row.more_replies ?? false,
  };
}

/** What `social.thread_previews` answers for each post it found. */
export type PreviewRow = { post_id: string; replies: ThreadReplyRow[]; more_replies: boolean };

/** A call for the previews of some posts: those it found, in any order (a post it can't read is left out). */
export type PreviewLoader = (postIds: string[]) => Promise<PostPreview[]>;

/**
 * The previews of up to 50 posts in one call of one function, as nobody (`asApp`); a post that isn't live is
 * left out of the answer.
 */
export async function loadPreviews(postIds: string[]): Promise<PostPreview[]> {
  const answer = await asApp((tx) =>
    one<{ previews: PreviewRow[] }>(
      tx,
      'select social.thread_previews($1::text[], $2, $3) as answer',
      [postIds, DESK_REPLIES, DESK_CHILDREN],
    ),
  );
  return answer.previews.map((row) => ({
    postId: row.post_id,
    replies: row.replies.map(previewReplyOf),
    moreReplies: row.more_replies,
  }));
}

/** Someone waiting for a post's preview. */
type Waiter = {
  postId: string;
  resolve: (preview: PostPreview) => void;
  reject: (error: unknown) => void;
};

/**
 * A batcher for previews (the DataLoader pattern; r7-design.md, section 4, rule 2): `ask(postId)` gives that
 * post's preview, and every ask made in the same tick is answered by one `load`.
 *
 * - **The first ask of a tick opens a batch** and schedules its flush with `setTimeout(…, 0)`, which runs after
 *   React has called every card's slot in the same pass; asks before the flush join the batch.
 * - **A flush calls `load` once for every 50 posts** (each post once, in the order first asked), and each ask
 *   answers its own post's preview, or an empty one when the post isn't in the answer.
 * - **A batch is closed when it flushes and never reused,** and nothing is kept after it answers (the pages are
 *   dynamic).
 * - **A failed `load` rejects only the asks it carried:** each ask's own promise is the only place the error
 *   goes, so a caller that catches it leaves nothing unhandled, and the asks of another call of the same flush
 *   (when it takes more than 50 posts) still answer.
 */
export function makePreviewBatcher(load: PreviewLoader): (postId: string) => Promise<PostPreview> {
  let open: Waiter[] | null = null;

  const flush = async (waiters: Waiter[]) => {
    const ids = [...new Set(waiters.map((waiter) => waiter.postId))];
    const chunks: string[][] = [];
    for (let at = 0; at < ids.length; at += PREVIEW_BATCH)
      chunks.push(ids.slice(at, at + PREVIEW_BATCH));
    await Promise.all(
      chunks.map(async (chunk) => {
        const mine = waiters.filter((waiter) => chunk.includes(waiter.postId));
        try {
          const found = new Map((await load(chunk)).map((preview) => [preview.postId, preview]));
          for (const waiter of mine) {
            waiter.resolve(found.get(waiter.postId) ?? emptyPreview(waiter.postId));
          }
        } catch (error) {
          for (const waiter of mine) waiter.reject(error);
        }
      }),
    );
  };

  return (postId) =>
    new Promise<PostPreview>((resolve, reject) => {
      if (open === null) {
        const batch: Waiter[] = [];
        open = batch;
        setTimeout(() => {
          if (open === batch) open = null;
          void flush(batch);
        }, 0);
      }
      open.push({ postId, resolve, reject });
    });
}

/** One batcher for each request: React's `cache()` is made once, here, so every card of a request shares it. */
const requestBatcher = cache(() => makePreviewBatcher(loadPreviews));

/** A post's preview for a desk card, batched with every other card's of the request into one call. */
export const previewOf = (postId: string): Promise<PostPreview> => requestBatcher()(postId);
