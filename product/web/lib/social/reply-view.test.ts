import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import {
  CURSOR_NOTE,
  countText,
  isThreadPost,
  type PreviewReply,
  REPLY_NOTE,
  replyTree,
  statsText,
  threadHref,
  threadView,
} from './reply-view.ts';

/**
 * What the sandbox's replies and counts look like (docs/social/r7-design.md, section 4, rules 3, 5 and 6), with
 * real numbers: the components only draw what these answer (Vitest can't load this project's JSX, and no sandbox
 * component is rendered in a test, so the decisions are made here, in plain functions, and held here).
 */

const POST = '019a7b10-0000-7000-8000-00000000aa01';
const exampleReply = examples.replies.reply;

/** A reply with its own ID, depth and number of replies under it. */
function reply(id: string, depth: number, children: number) {
  return { ...exampleReply, id, postId: POST, depth, children };
}

/** A top-level reply with replies under it. */
function top(id: string, under: ReturnType<typeof reply>[], moreReplies = false): PreviewReply {
  return { reply: reply(id, 0, under.length), replies: under, moreReplies };
}

describe('the words of a post’s counts', () => {
  it('say "1 reply" and "1 upvote" for one, the plural for any other number', () => {
    expect(statsText({ replies: 1, upvotes: 1 })).toEqual({
      replies: '1 reply',
      upvotes: '1 upvote',
    });
    expect(statsText({ replies: 3, upvotes: 2 })).toEqual({
      replies: '3 replies',
      upvotes: '2 upvotes',
    });
    expect(statsText({ replies: 0, upvotes: 0 })).toEqual({
      replies: '0 replies',
      upvotes: '0 upvotes',
    });
    expect(statsText({ replies: 12, upvotes: 1 })).toEqual({
      replies: '12 replies',
      upvotes: '1 upvote',
    });
  });

  it('count anything a noun is given for', () => {
    expect(countText(1, 'view', 'views')).toBe('1 view');
    expect(countText(1204, 'view', 'views')).toBe('1204 views');
  });

  it('tell the thread page’s own post (the detail, with its replies) from a card', () => {
    expect(isThreadPost(examples.agents.postDetail)).toBe(true);
    expect(isThreadPost(examples.agents.postCard)).toBe(false);
  });
});

describe('addresses', () => {
  it('write the thread, a reply’s replies and a later page', () => {
    expect(threadHref(POST)).toBe(`/sandbox/social/posts/${POST}`);
    expect(threadHref(POST, { reply: 'r1' })).toBe(`/sandbox/social/posts/${POST}?reply=r1`);
    expect(threadHref(POST, { reply: 'r1', cursor: 'c9' })).toBe(
      `/sandbox/social/posts/${POST}?reply=r1&cursor=c9`,
    );
    expect(threadHref(POST, { cursor: 'c9' })).toBe(`/sandbox/social/posts/${POST}?cursor=c9`);
  });
});

describe('the tree of replies a desk card or a thread draws', () => {
  it('draws two levels, and "Replies to this" at the third: only on a reply below the top that has replies of its own', () => {
    const nodes = replyTree(POST, [
      top('ask', [reply('answer', 1, 1), reply('thanks', 1, 0)]),
      top('own', []),
    ]);
    expect(nodes.map((node) => node.reply.id)).toEqual(['ask', 'own']);
    const ask = nodes[0];
    expect(ask?.children.map((child) => child.reply.id)).toEqual(['answer', 'thanks']);
    // The answer has a reply of its own (the third level): its link leads to the replies under it.
    expect(ask?.children[0]?.link).toEqual({
      text: 'Replies to this',
      href: `/sandbox/social/posts/${POST}?reply=answer`,
    });
    // A reply with nothing under it has no link; neither does a top-level reply that has nothing more.
    expect(ask?.children[1]?.link).toBeNull();
    expect(ask?.more).toBeNull();
    expect(nodes[1]?.children).toEqual([]);
    expect(nodes[1]?.more).toBeNull();
  });

  it('gives a top-level reply "More replies" when it has more than are shown, leading to the replies under it', () => {
    const nodes = replyTree(POST, [
      top('busy', [reply('c1', 1, 0), reply('c2', 1, 0)], true),
      top('quiet', [reply('c3', 1, 0)]),
    ]);
    expect(nodes[0]?.more).toEqual({
      text: 'More replies',
      href: `/sandbox/social/posts/${POST}?reply=busy`,
    });
    expect(nodes[1]?.more).toBeNull();
  });

  it('keeps the order it was given, and draws nothing for no replies', () => {
    expect(
      replyTree(POST, [top('b', []), top('a', []), top('c', [])]).map((node) => node.reply.id),
    ).toEqual(['b', 'a', 'c']);
    expect(replyTree(POST, [])).toEqual([]);
  });
});

describe('the thread page’s address', () => {
  const REPLY = '019A7B10-0000-7000-8000-00000000BB02';

  it('takes nothing, or a reply and a cursor, with no line when they are fine', () => {
    expect(threadView({})).toEqual({ notes: [] });
    const view = threadView({ reply: REPLY, cursor: '019a7b10-0000-7000-8000-00000000cc03' });
    expect(view).toEqual({
      reply: REPLY.toLowerCase(),
      cursor: '019a7b10-0000-7000-8000-00000000cc03',
      notes: [],
    });
  });

  it('drops a reply that is not a UUID with a line, and the cursor with it', () => {
    expect(threadView({ reply: 'nonsense', cursor: 'whatever' })).toEqual({ notes: [REPLY_NOTE] });
    expect(threadView({ reply: ['a', 'b'] })).toEqual({ notes: [REPLY_NOTE] });
  });

  it('passes a cursor as it was sent, for the database to read, and drops one sent twice with a line', () => {
    expect(threadView({ cursor: 'not-a-uuid' })).toEqual({ cursor: 'not-a-uuid', notes: [] });
    expect(threadView({ cursor: ['a', 'b'] })).toEqual({ notes: [CURSOR_NOTE] });
  });

  it('treats an empty value as not sent', () => {
    expect(threadView({ reply: '', cursor: '' })).toEqual({ notes: [] });
  });
});
