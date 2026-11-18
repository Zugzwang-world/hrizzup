import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { isThreadPost, replyTree, threadHref } from '@/lib/social/reply-view.ts';
import { previewOf } from '@/lib/social/threads.ts';
import { ReplyTree } from './reply-tree.tsx';

/**
 * A post's replies under its card on a desk or a profile (R7; docs/social/r7-design.md, section 4, rule 3): its
 * first three replies, each with its first two, then "Open the thread". It is an async server component: every
 * card of a request asks `previewOf`, and the asks of one request are sent as one database call (rule 11).
 *
 * - **The thread page's own card** is given a `PostDetail`, and draws nothing here (the page draws the thread).
 * - **A call that fails** draws nothing, and logs only the error's name: the posts show without their replies,
 *   and the page doesn't fail.
 * - **A post with no replies** draws nothing.
 */
export async function PostReplies({ post }: { post: social.PostCard | social.PostDetail }) {
  if (isThreadPost(post)) return null;
  let preview: Awaited<ReturnType<typeof previewOf>>;
  try {
    preview = await previewOf(post.id);
  } catch (error) {
    console.error(
      `A post's replies could not be read: ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return null;
  }
  if (preview.replies.length === 0) return null;
  return (
    <div className="mt-3 min-w-0" data-testid="post-replies">
      <ReplyTree nodes={replyTree(post.id, preview.replies)} />
      <Link
        href={threadHref(post.id)}
        prefetch={false}
        className="inline-flex min-h-11 items-center underline"
        data-testid="thread-link"
      >
        Open the thread
      </Link>
    </div>
  );
}
