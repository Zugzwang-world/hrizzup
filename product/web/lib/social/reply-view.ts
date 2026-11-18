import type { social } from '@hrizzup/api';

/**
 * What a post's replies look like on the sandbox's pages, decided in plain functions (R7;
 * docs/social/r7-design.md, section 4, rules 3, 5 and 6): the words of the counts, the tree of replies a
 * desk card or a thread draws and the link each part gets. The components (`post-stats.tsx`,
 * `post-replies.tsx`, `thread.tsx`) only draw what these answer, so every decision is tested here with real
 * numbers (Vitest can't load this project's JSX, and no sandbox component is rendered in a test).
 *
 * Imports only types, so a test needs nothing of the database or the pages.
 */

/** A top-level reply, with its first replies and whether it has more than those. */
export type PreviewReply = {
  reply: social.Reply;
  replies: social.Reply[];
  moreReplies: boolean;
};

/** What a desk card shows of one post's replies: the first top-level replies, and whether there are more. */
export type PostPreview = {
  postId: string;
  replies: PreviewReply[];
  moreReplies: boolean;
};

/** The preview of a post that has no replies, or that the database didn't answer for. */
export const emptyPreview = (postId: string): PostPreview => ({
  postId,
  replies: [],
  moreReplies: false,
});

/** A link a reply gets: what it says, and where it goes. */
export type ReplyLink = { text: string; href: string };

/** A reply under a top-level one, with "Replies to this" when it has replies of its own (one level further down). */
export type ChildNode = { reply: social.Reply; link: ReplyLink | null };

/** A top-level reply, the replies under it, and "More replies" when it has more than those. */
export type ReplyNode = { reply: social.Reply; children: ChildNode[]; more: ReplyLink | null };

/** A thread's address, or the address of the replies under one reply (`reply`), from a page's start (`cursor`). */
export function threadHref(postId: string, view: { reply?: string; cursor?: string } = {}): string {
  const query = new URLSearchParams();
  if (view.reply) query.set('reply', view.reply);
  if (view.cursor) query.set('cursor', view.cursor);
  const text = query.toString();
  return `/sandbox/social/posts/${postId}${text ? `?${text}` : ''}`;
}

/** "1 reply", "3 replies": a count with its noun, the plural for any number but one. */
export function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The words of a post's counts. */
export function statsText(counts: { replies: number; upvotes: number }): {
  replies: string;
  upvotes: string;
} {
  return {
    replies: countText(counts.replies, 'reply', 'replies'),
    upvotes: countText(counts.upvotes, 'upvote', 'upvotes'),
  };
}

/**
 * Whether a post is the thread page's own, which carries its first replies (`PostDetail`; a card on a desk or a
 * profile doesn't): that page draws the thread itself, so its card links nowhere and shows no preview.
 */
export function isThreadPost(post: social.PostCard | social.PostDetail): post is social.PostDetail {
  return 'replies' in post;
}

/**
 * The tree a level of replies draws, two levels deep: each reply with the replies under it, "More replies" on a
 * reply that has more than those shown (it leads to the replies under it), and "Replies to this" on one of those
 * that has replies of its own (the third level, which is never drawn on this page). A reply's own children are
 * `children` on the card: a reply under it that has some leads to them.
 */
export function replyTree(postId: string, replies: readonly PreviewReply[]): ReplyNode[] {
  return replies.map(({ reply, replies: under, moreReplies }) => ({
    reply,
    children: under.map((child) => ({
      reply: child,
      link:
        child.children > 0
          ? { text: 'Replies to this', href: threadHref(postId, { reply: child.id }) }
          : null,
    })),
    more: moreReplies
      ? { text: 'More replies', href: threadHref(postId, { reply: reply.id }) }
      : null,
  }));
}

// ---------------------------------------------------------------------------------------------
// The thread page's address
// ---------------------------------------------------------------------------------------------

/** What Next.js hands a page for one name in the address: text, a list when it is sent twice, or nothing. */
type Raw = string | string[] | undefined;

/** What the thread page shows: the reply whose replies it opens, where its page starts, and the lines for what was dropped. */
export type ThreadView = { reply?: string; cursor?: string; notes: string[] };

export const REPLY_NOTE = "That reply isn't in this thread: here is the post's own.";
export const CURSOR_NOTE = "That page isn't one of this thread's: showing the first page.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The thread page's view of an address's query (`reply` and `cursor`): `reply` must be a UUID (lower-cased), or it
 * is dropped with a plain line saying so, and the cursor with it, since a cursor is only a place in one level. A
 * cursor is passed as sent, for the database to read (a bad one is a 400 the page answers by starting again); one
 * sent twice is dropped. Nothing sent is ever repeated on the page.
 */
export function threadView(query: Record<string, Raw>): ThreadView {
  const notes: string[] = [];
  const sent = (raw: Raw) => raw !== undefined && raw !== '';
  let reply: string | undefined;
  if (sent(query.reply)) {
    if (typeof query.reply === 'string' && UUID.test(query.reply))
      reply = query.reply.toLowerCase();
    else notes.push(REPLY_NOTE);
  }
  let cursor: string | undefined;
  if (sent(query.cursor) && !(sent(query.reply) && reply === undefined)) {
    if (typeof query.cursor === 'string') cursor = query.cursor;
    else notes.push(CURSOR_NOTE);
  }
  return {
    ...(reply === undefined ? {} : { reply }),
    ...(cursor === undefined ? {} : { cursor }),
    notes,
  };
}
