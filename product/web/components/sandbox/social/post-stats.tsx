import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { isThreadPost, statsText, threadHref } from '@/lib/social/reply-view.ts';
import { viewsText } from '@/lib/social/views-text.ts';

/**
 * A post's counts (R7: replies and upvotes; docs/social/r7-design.md, section 4, rule 5; R11: views,
 * docs/social/r11-design.md, section 4, rule 4): "1 reply" or "3 replies", "1 upvote" or "2 upvotes", then its
 * views, "2 views (2 readers)" (`viewsText`: the total, then the different devices). The replies lead to the post's
 * thread, except on the thread page's own card, where they are plain words. They are recounted by the minute job, so
 * up to a minute old. Given the whole post, never picked fields, since its callers aren't this file's to change.
 */
export function PostStats({ post }: { post: social.PostCard | social.PostDetail }) {
  const words = statsText(post.counts);
  return (
    <p
      className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 text-sm text-muted"
      data-testid="post-stats"
    >
      {isThreadPost(post) ? (
        <span>{words.replies}</span>
      ) : (
        <Link
          href={threadHref(post.id)}
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
          data-testid="post-replies-link"
        >
          {words.replies}
        </Link>
      )}{' '}
      <span>{words.upvotes}</span>{' '}
      <span data-testid="post-views">{viewsText(post.counts.views, post.counts.uniqueViews)}</span>
    </p>
  );
}
