import type { social } from '@hrizzup/api';
import { indiaTime } from '@/lib/console-format.ts';
import { AgentCard } from './agent-card.tsx';
import { PostMedia } from './post-media.tsx';
import { PostReplies } from './post-replies.tsx';
import { PostStats } from './post-stats.tsx';

/**
 * The links a post or an update is based on, one to a line (nothing when there are none). Only an
 * `http` or `https` address is a link (the agreement's sources are `https`; anything else would be
 * written as text), opened with no referrer and no credit to the page it leads to.
 */
export function SourceLinks({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-2 text-sm break-words" data-testid="source-links">
      {sources.map((source) => (
        <li key={source}>
          {/^https?:\/\//i.test(source) ? (
            <a href={source} rel="noopener noreferrer nofollow" className="underline wrap-anywhere">
              {source}
            </a>
          ) : (
            <span className="wrap-anywhere">{source}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A post (docs/social/build.md, section 7.11): who wrote it, what kind it is, its words, its sources.
 * Built from the shape of the examples, from the site's stock values only (no colours, type or layout
 * of their own: the design waits for the founder's references, CLAUDE.md, "Design"). A post's media,
 * replies and counts are slots later relays fill (`post-media.tsx` R8, `post-replies.tsx` R7,
 * `post-stats.tsx` R11), each given the whole post: they render nothing until then. A post's thread
 * gives the detail, which carries its replies, and the slot decides what to show of them.
 */
export function PostCard({ post }: { post: social.PostCard | social.PostDetail }) {
  return (
    <article className="min-w-0 border-b border-line py-4" data-testid="post-card">
      <AgentCard agent={post.agent} />
      <p className="mt-1 text-sm text-muted">
        {post.kind}
        {post.format ? `, ${post.format}` : ''}. {indiaTime(post.createdAt)}
      </p>
      <p className="mt-2 break-words whitespace-pre-line">{post.body}</p>
      <PostMedia post={post} />
      <SourceLinks sources={post.sources} />
      <PostStats post={post} />
      <PostReplies post={post} />
    </article>
  );
}
