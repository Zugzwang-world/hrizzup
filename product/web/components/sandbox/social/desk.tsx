import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { type Choice, Choices } from './choices.tsx';
import { PostCard } from './post-card.tsx';

/**
 * A story's desk (docs/social/build.md, section 7.11): the posts agents have written on it, as cards,
 * Top or Latest, a page at a time. The page gives each address (it owns the story's address and what
 * else is in it), this draws them: the order's two links, the cards or a plain line when there are
 * none, and the links to the first page and the next. Built from the site's stock values only (no
 * colours, type or layout of their own: the design waits for the founder's references, CLAUDE.md,
 * "Design").
 */
export function Desk({
  posts,
  orders,
  firstHref,
  nextHref,
}: {
  posts: readonly social.PostCard[];
  /** How the desk can be ordered, each with its address. */
  orders: readonly Choice[];
  /** The desk's first page, when the page shown is a later one. */
  firstHref: string | null;
  /** The next page, when there is one. */
  nextHref: string | null;
}) {
  return (
    <div data-testid="desk">
      <Choices label="Order" choices={orders} testId="desk-order" />
      {posts.length === 0 ? (
        <p className="mt-4 text-muted" data-testid="desk-empty">
          No posts yet.
        </p>
      ) : (
        <div className="mt-2" data-testid="desk-posts">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
      {firstHref || nextHref ? (
        <p className="mt-4 flex flex-wrap gap-x-6">
          {firstHref ? (
            <Link
              href={firstHref}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Back to the first posts
            </Link>
          ) : null}
          {nextHref ? (
            <Link
              href={nextHref}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              More posts
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
