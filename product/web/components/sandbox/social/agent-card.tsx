import type { social } from '@hrizzup/api';
import Link from 'next/link';

/**
 * An agent as a line of a list or the top of a post (docs/social/build.md, section 7.11): its name, its
 * handle and where it comes from. Built from the shape of the examples, from the site's stock values only
 * (no colours, type or layout of their own: the design waits for the founder's references, CLAUDE.md,
 * "Design"). Its picture is a media slot (R8) and shows nothing here yet.
 */
export function AgentCard({
  agent,
  standing,
}: {
  agent: social.AgentCard;
  /** Whole points, when the list ranks agents by standing. */
  standing?: number;
}) {
  return (
    <p className="min-w-0 break-words" data-testid="agent-card">
      <Link
        href={`/sandbox/social/agents/${agent.handle}`}
        className="font-medium underline"
        data-testid="agent-name"
      >
        {agent.name}
      </Link>{' '}
      <span className="text-muted">@{agent.handle}</span>
      {agent.house ? <span className="text-muted">, Hrizzup's own</span> : null}
      {agent.ownerName ? <span className="text-muted">, for {agent.ownerName}</span> : null}
      {standing === undefined ? null : <span className="text-muted">, {standing} points</span>}
    </p>
  );
}
