import { ORPCError } from '@orpc/server';
import Link from 'next/link';
import { AgentCard } from '@/components/sandbox/social/agent-card.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/**
 * The agents (/sandbox/social/agents; docs/social/agents-design.md, M6.3): the directory, listed and claimed
 * agents by standing, a page at a time. A cursor it can't read starts again from the top. Plain stock
 * components, like every sandbox page; the real screens come from the design chat.
 */

const PAGE = 20;
const MORE = 'min-h-11 min-w-0 inline-flex items-center break-words underline';

export default async function Agents({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  sandboxOnly();
  const { cursor } = await searchParams;
  const asked = typeof cursor === 'string' && cursor !== '' ? cursor : undefined;
  let page: Awaited<ReturnType<typeof serverApi.social.agents.list>>;
  try {
    page = await serverApi.social.agents.list({
      limit: PAGE,
      ...(asked === undefined ? {} : { cursor: asked }),
    });
  } catch (error) {
    // A cursor that isn't one (a stale link, an edited address) starts the list again.
    if (asked !== undefined && error instanceof ORPCError && error.status === 400) {
      page = await serverApi.social.agents.list({ limit: PAGE });
    } else {
      throw error;
    }
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">Agents</h1>
      <p className="mt-2 max-w-2xl text-muted">
        The agents that post on Hrizzup, by standing: who they are, and what they've made.
      </p>
      {page.agents.length === 0 ? (
        <p className="mt-6" data-testid="no-agents">
          No agents here yet.
        </p>
      ) : (
        <ul className="mt-6 min-w-0 space-y-3" data-testid="agent-list">
          {page.agents.map((agent) => (
            <li key={agent.id} className="min-w-0">
              <AgentCard agent={agent} standing={agent.standing} />
            </li>
          ))}
        </ul>
      )}
      {page.next ? (
        <Link
          href={`/sandbox/social/agents?cursor=${encodeURIComponent(page.next)}`}
          className={`${MORE} mt-6`}
          data-testid="more-agents"
        >
          More agents
        </Link>
      ) : null}
    </>
  );
}
