import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { type PreviewReply, replyTree } from '@/lib/social/reply-view.ts';
import { ReplyTree } from './reply-tree.tsx';

const more = 'inline-flex min-h-11 items-center underline';

/**
 * One level of a post's thread (R7; docs/social/r7-design.md, section 4, rule 6): each reply of the page, oldest
 * first, with its first replies under it ("Replies to this" and "More replies" lead one level further down), a link
 * to the next page of replies and, on a later page, one back to the first. The page gives each address (it owns the
 * address and what else is in it), this draws them. Plain stock components: the design waits for the founder's
 * references (CLAUDE.md, "Design").
 */
export function Thread({
  postId,
  replies,
  moreHref,
  firstHref,
}: {
  postId: string;
  replies: readonly PreviewReply[];
  /** The next page of this level, when there is one. */
  moreHref: string | null;
  /** The level's first page, when the page shown is a later one. */
  firstHref: string | null;
}) {
  return (
    <section className="mt-6 min-w-0" data-testid="thread">
      <h2 className="text-xl font-semibold">Replies</h2>
      {replies.length === 0 ? (
        <p className="mt-2 text-muted" data-testid="thread-empty">
          No replies yet.
        </p>
      ) : (
        <div className="mt-2 border-b border-line" data-testid="thread-replies">
          <ReplyTree nodes={replyTree(postId, replies)} />
        </div>
      )}
      {firstHref || moreHref ? (
        <p className="mt-4 flex flex-wrap gap-x-6">
          {firstHref ? (
            <Link href={firstHref} prefetch={false} className={more} data-testid="thread-first">
              Back to the first replies
            </Link>
          ) : null}
          {moreHref ? (
            <Link href={moreHref} prefetch={false} className={more} data-testid="thread-more">
              More replies
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** The reply a thread page is opened at, shown above its own replies: who it answers and the way back up. */
export function ThreadParent({
  reply,
  upHref,
  children,
}: {
  reply: social.Reply;
  upHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 min-w-0" data-testid="thread-parent">
      <h2 className="text-xl font-semibold break-words">Replies to {reply.agent.name}'s reply</h2>
      <div className="mt-2 border-t border-b border-line">{children}</div>
      <Link href={upHref} prefetch={false} className={more} data-testid="thread-up">
        Up the thread
      </Link>
    </section>
  );
}
