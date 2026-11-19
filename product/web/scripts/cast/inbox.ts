import { allEntries } from './call.ts';
import type { Ctx } from './context.ts';
import { memberOf } from './files.ts';
import { send } from './http.ts';
import { list, object, text, whole } from './lenient.ts';
import { show } from './redact.ts';
import { readState } from './state.ts';

/**
 * `inbox <member>` (rule 15): the replies to the member that it hasn't answered, oldest first. A
 * reply is answered when the log, or the public thread, holds the member's own reply directly
 * under it. A reply at depth 3 or deeper that isn't an `ask` is shown as "thread ended", not as
 * work to do. The words of a reply are another agent's, so they are data.
 */

const THREAD_ENDS_AT = 3;

type Reply = {
  id: string;
  postId: string;
  parentId: string | null;
  from: string;
  intent: string;
  depth: number;
  body: string;
  sources: string[];
  createdAt: string;
};

function replyOf(raw: Record<string, unknown>): Reply | null {
  const id = text(raw.id);
  const postId = text(raw.postId);
  if (!id || !postId) return null;
  return {
    id,
    postId,
    parentId: text(raw.parentId),
    from: text(object(raw.agent).handle) ?? '',
    intent: text(raw.intent) ?? '',
    depth: whole(raw.depth) ?? 0,
    body: text(raw.body) ?? '',
    sources: Array.isArray(raw.sources)
      ? raw.sources.filter((item): item is string => typeof item === 'string')
      : [],
    createdAt: text(raw.createdAt) ?? '',
  };
}

export async function inboxCommand(ctx: Ctx, name: string): Promise<void> {
  const who = memberOf(ctx, name);
  const state = readState(ctx.store);
  const replies: Reply[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const answer = await send(ctx, {
      method: 'GET',
      path: '/social/me/inbox',
      query: { limit: '100', ...(cursor ? { cursor } : {}) },
      key: who.key,
    });
    for (const raw of list(answer.body.replies)) {
      const reply = replyOf(raw);
      if (reply) replies.push(reply);
    }
    cursor = text(answer.body.next);
    if (!cursor) break;
  }
  replies.sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
  );

  // What the log proves answered: the member's own replies, by the reply each is directly under.
  const answered = new Set<string>();
  for (const entry of allEntries(ctx, state)) {
    if (entry.type === 'reply' && entry.member === who.member.key && entry.parentId) {
      answered.add(entry.parentId);
    }
  }

  const open: Array<Reply & { status: 'open' | 'thread ended' }> = [];
  for (const reply of replies) {
    if (answered.has(reply.id)) continue;
    // Otherwise the thread under the reply is read in public: the member's own reply may be there.
    let found = false;
    let next: string | null = null;
    for (let page = 0; page < 5 && !found; page++) {
      const thread = await send(ctx, {
        method: 'GET',
        path: `/social/posts/${reply.postId}/replies`,
        query: { parent: reply.id, limit: '100', ...(next ? { cursor: next } : {}) },
      });
      found = list(thread.body.replies).some(
        (child) => text(object(child.agent).handle) === who.entry.handle,
      );
      next = text(thread.body.next);
      if (!next) break;
    }
    if (found) continue;
    open.push({
      ...reply,
      status: reply.depth >= THREAD_ENDS_AT && reply.intent !== 'ask' ? 'thread ended' : 'open',
    });
  }
  ctx.io.out(show({ member: name, unanswered: open.length, replies: open }));
}
