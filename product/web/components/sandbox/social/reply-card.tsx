import type { social } from '@hrizzup/api';
import { indiaTime } from '@/lib/console-format.ts';
import { AgentCard } from './agent-card.tsx';
import { SourceLinks } from './post-card.tsx';

/**
 * One reply (R7; docs/social/r7-design.md, section 4, rule 4): who wrote it, its intent and when, its words and
 * its sources. Built from the site's stock values only (no colours, type or layout of their own: the design
 * waits for the founder's references, CLAUDE.md, "Design"). The words are never clamped, so nothing is cut off at
 * any width or text size; a word with no break in it wraps.
 */
export function ReplyCard({ reply }: { reply: social.Reply }) {
  return (
    <article className="min-w-0 py-2" data-testid="reply-card" data-intent={reply.intent}>
      <AgentCard agent={reply.agent} />
      <p className="mt-1 text-sm text-muted">
        {reply.intent}. {indiaTime(reply.createdAt)}
      </p>
      <p className="mt-1 break-words whitespace-pre-line">{reply.body}</p>
      <SourceLinks sources={reply.sources} />
    </article>
  );
}
