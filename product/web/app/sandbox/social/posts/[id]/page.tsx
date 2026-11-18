import { social } from '@hrizzup/api';
import { brand } from '@hrizzup/core';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PostCard } from '@/components/sandbox/social/post-card.tsx';
import { ReplyCard } from '@/components/sandbox/social/reply-card.tsx';
import { Thread, ThreadParent } from '@/components/sandbox/social/thread.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { CURSOR_NOTE, REPLY_NOTE, threadHref, threadView } from '@/lib/social/reply-view.ts';
import {
  previewReplyOf,
  replyOf,
  THREAD_CHILDREN,
  THREAD_PAGE,
  type ThreadRow,
  threadOf,
} from '@/lib/social/threads.ts';

// The sandbox's layout sets its own title, which leaves a page's without the site's template: spelt out.
export const metadata: Metadata = { title: { absolute: `A post's thread · ${brand.name}` } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const isCode = (error: unknown, code: 'NOT_FOUND' | 'BAD_REQUEST') =>
  error instanceof ORPCError && error.code === code;

/** A read's outcome, kept so a refusal can be answered by reading again. */
type Read = PromiseSettledResult<ThreadRow>;

/**
 * One post's thread (/sandbox/social/posts/<id>; docs/social/r7-design.md, section 4, rule 6): the post's own
 * card, and its replies a level at a time, oldest first, each with its first three replies under it. `reply` opens
 * the replies under one reply (with that reply above them and a way back up), and `cursor` pages a level. The post
 * and its first level are read together; a post that isn't there is "not found", a `reply` that isn't in this
 * post's thread shows the post's own top level with a line saying so, and a cursor the database can't read starts
 * the level again, each at most once. Anything else is ours to fix. The page is read for every visitor in the
 * browser's own request (never an edge copy), so a reply shows at once. Plain stock components: the design
 * waits for the founder's references (CLAUDE.md, "Design").
 */
export default async function SocialThread({ params, searchParams }: Props) {
  sandboxOnly();
  const { id: asked } = await params;
  if (!social.postAddress.safeParse({ id: asked }).success) notFound();
  const id = asked.toLowerCase();
  const view = threadView(await searchParams);
  let { reply, cursor } = view;
  const notes = [...view.notes];

  const read = (parent: string | undefined, from: string | undefined): Promise<Read> =>
    threadOf({
      postId: id,
      parent: parent ?? null,
      cursor: from ?? null,
      size: THREAD_PAGE,
      nested: THREAD_CHILDREN,
    }).then(
      (value): Read => ({ status: 'fulfilled', value }),
      (reason: unknown): Read => ({ status: 'rejected', reason }),
    );

  const [post, first] = await Promise.all([
    serverApi.social.posts.get({ id }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    ),
    read(reply, cursor),
  ]);
  if (post.status === 'rejected') {
    // No such post (or none a reader may see): not found. Anything else is ours to fix.
    if (isCode(post.reason, 'NOT_FOUND')) notFound();
    throw post.reason;
  }

  // A cursor the database can't read starts the level again; a reply that isn't in this post's thread drops the
  // reply (and the cursor, a place in its level). Each takes one more read at most: two in all.
  let result = first;
  while (result.status === 'rejected') {
    if (cursor !== undefined && isCode(result.reason, 'BAD_REQUEST')) {
      notes.push(CURSOR_NOTE);
      cursor = undefined;
    } else if (reply !== undefined && isCode(result.reason, 'NOT_FOUND')) {
      notes.push(REPLY_NOTE);
      reply = undefined;
      cursor = undefined;
    } else {
      break;
    }
    result = await read(reply, cursor);
  }
  if (result.status === 'rejected') {
    if (isCode(result.reason, 'NOT_FOUND')) notFound();
    throw result.reason;
  }
  const thread = result.value;
  const parent = thread.parent ? replyOf(thread.parent) : null;

  return (
    <>
      <h1 className="text-3xl font-semibold">A post's thread</h1>
      <p>
        <Link
          href={`/sandbox/social/stories/${post.value.storyId}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
          data-testid="thread-story"
        >
          Back to the story
        </Link>
      </p>
      {notes.length > 0 ? (
        <div className="mt-2 text-sm" data-testid="thread-notes">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
      <PostCard post={post.value} />
      {parent ? (
        <ThreadParent
          reply={parent}
          upHref={threadHref(id, parent.parentId ? { reply: parent.parentId } : {})}
        >
          <ReplyCard reply={parent} />
        </ThreadParent>
      ) : null}
      <Thread
        postId={id}
        replies={thread.replies.map(previewReplyOf)}
        moreHref={
          thread.next ? threadHref(id, { ...(reply ? { reply } : {}), cursor: thread.next }) : null
        }
        firstHref={cursor ? threadHref(id, reply ? { reply } : {}) : null}
      />
    </>
  );
}
