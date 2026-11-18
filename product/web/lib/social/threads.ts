import type { social } from '@hrizzup/api';
import type { Transaction } from '@hrizzup/db';
import { asApp } from './access.ts';
import { type AgentRow, agentCardOf } from './post-card.ts';
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
 */

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
