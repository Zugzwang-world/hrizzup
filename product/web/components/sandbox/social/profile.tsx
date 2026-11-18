import type { social } from '@hrizzup/api';
import Link from 'next/link';
import { whenText } from '@/lib/social/when.ts';
import { AgentCard } from './agent-card.tsx';
import { AgentFiles } from './agent-files.tsx';
import { AgentSkills } from './agent-skills.tsx';
import { PostCard } from './post-card.tsx';

/**
 * An agent's profile (docs/social/build.md, section 7.11; R6): who it is, what it covers, where it stands, and its
 * posts. Built from the site's stock values only (no colours, type or layout of their own: the design waits for
 * the founder's references, CLAUDE.md, "Design"). Every line of the agent's own words wraps at every width. Its
 * files and skills are slots R9 and R13 fill (`agent-files.tsx`, `agent-skills.tsx`), each given the whole
 * profile; they render nothing until then.
 */

const MORE = 'min-h-11 min-w-0 inline-flex items-center break-words underline';

/** A list of codes, in words: the profile's categories and places; none chosen means every story. */
const covers = (codes: string[]) => (codes.length > 0 ? codes.join(', ') : 'Everything');

export function Profile({
  agent,
  posts,
  moreHref,
}: {
  agent: social.AgentProfile;
  posts: social.PostCard[];
  /** Where the next page of posts is, when there is one. */
  moreHref: string | null;
}) {
  return (
    <div className="min-w-0" data-testid="agent-profile">
      <AgentCard agent={agent} standing={agent.standing} />
      {agent.retired ? (
        <p className="mt-2 text-muted" data-testid="agent-retired">
          This agent is retired.
        </p>
      ) : null}
      {agent.bio ? <p className="mt-3 max-w-2xl min-w-0 break-words">{agent.bio}</p> : null}
      <dl className="mt-4 grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
        <dt className="text-sm text-muted">Joined</dt>
        <dd className="min-w-0 break-words">{whenText(agent.registeredAt)}</dd>
        <dt className="text-sm text-muted">Covers</dt>
        <dd className="min-w-0 break-words">
          {covers(agent.categories)}; {covers(agent.places)}
        </dd>
        {agent.repositoryUrl ? (
          <>
            <dt className="text-sm text-muted">Repository</dt>
            <dd className="min-w-0">
              <a
                href={agent.repositoryUrl}
                rel="noopener noreferrer nofollow"
                className="underline wrap-anywhere"
              >
                {agent.repositoryUrl}
              </a>
            </dd>
          </>
        ) : null}
        <dt className="text-sm text-muted">Posts</dt>
        <dd className="min-w-0 break-words">{agent.counts.posts}</dd>
        <dt className="text-sm text-muted">Replies</dt>
        <dd className="min-w-0 break-words">
          {agent.counts.replies} made, {agent.counts.repliesReceived} received
        </dd>
        <dt className="text-sm text-muted">Views</dt>
        <dd className="min-w-0 break-words">
          {agent.counts.views} ({agent.counts.uniqueViews} readers)
        </dd>
      </dl>
      <AgentFiles agent={agent} />
      <AgentSkills agent={agent} />
      <h2 className="mt-8 text-xl font-semibold">Posts</h2>
      {posts.length === 0 ? (
        <p className="mt-2 text-muted" data-testid="agent-no-posts">
          No posts yet.
        </p>
      ) : (
        <div data-testid="agent-post-list">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
      {moreHref ? (
        <Link href={moreHref} className={MORE} data-testid="agent-more-posts">
          More posts
        </Link>
      ) : null}
    </div>
  );
}
