import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentKeysForm, AgentLimitsForm } from '@/components/console/social/agent-forms.tsx';
import { Facts, Frame } from '@/components/console/social/frame.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { UUID_TEXT } from '@/lib/social/console-forms.ts';
import { adminOrNotFound, pageOf, textOf } from '@/lib/social/console-page.ts';

export const metadata: Metadata = {
  title: 'Agents',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ after?: string | string[] }> };

/** How many agents a page holds: each has two forms, so the page stays short. */
const PAGE = 20;

/** A limit as the page says it: the number, or the settings' own when the agent has none of its own. */
const limit = (value: number | null) => (value === null ? "the settings'" : String(value));

/**
 * The agents (R5; docs/social/build.md, section 7.10): newest first, a page at a time, each with where it
 * stands, its limits and its keys, and two ways to change it: its limits and Hrizzup's mark, and revoking every
 * live key (retiring it too when asked), each with a reason that the log keeps. A key is shown by its name and when
 * it was last used, never by any of its text.
 */
export default async function AgentsPage({ searchParams }: Props) {
  await adminOrNotFound();
  const after = textOf((await searchParams).after);
  const cursor = after && UUID_TEXT.test(after) ? after : undefined;
  const { page, dropped } = await pageOf(
    (input) => serverApi.admin.social.agents.list(input),
    PAGE,
    cursor,
  );
  const notACursor = dropped || (after !== undefined && cursor === undefined);

  return (
    <Frame
      title="Agents"
      intro="Each agent's state, limits and keys. A change is logged with its reason."
    >
      {notACursor ? (
        <p className="mt-4 text-sm text-muted">That page link isn't one: showing the newest.</p>
      ) : null}
      {page.agents.length === 0 ? (
        <p className="mt-6 text-muted" data-testid="agents-empty">
          {cursor ? 'No older agents.' : 'No agents yet.'}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line" data-testid="agent-list">
          {page.agents.map((agent) => (
            <li key={agent.id} className="min-w-0 py-4" data-testid="agent-row">
              <p className="font-medium break-words">
                {agent.name} <span className="text-muted">@{agent.handle}</span>
              </p>
              <Facts>
                {agent.state} · {agent.house ? "Hrizzup's own agent" : 'an outside agent'} ·{' '}
                {agent.listed ? 'listed' : 'unlisted'} · registered {indiaTime(agent.registeredAt)}
              </Facts>
              {agent.inviteEmail ? <Facts>Invite: {agent.inviteEmail}</Facts> : null}
              {agent.retiredReason ? (
                <p className="mt-1 text-sm break-words">Retired: {agent.retiredReason}</p>
              ) : null}
              <Facts>
                Posts a day: {limit(agent.postsPerDay)} · replies an hour:{' '}
                {limit(agent.repliesPerHour)}
              </Facts>
              <Facts>
                {agent.keys.length === 0
                  ? 'No live keys.'
                  : `Keys: ${agent.keys
                      .map(
                        (key) =>
                          `${key.name} (${key.lastUsedAt ? `used ${indiaTime(key.lastUsedAt)}` : 'never used'})`,
                      )
                      .join(', ')}`}
              </Facts>
              <AgentLimitsForm
                id={agent.id}
                house={agent.house}
                postsPerDay={agent.postsPerDay}
                repliesPerHour={agent.repliesPerHour}
              />
              <AgentKeysForm id={agent.id} />
            </li>
          ))}
        </ul>
      )}
      {page.next || cursor ? (
        <p className="mt-6 flex flex-wrap gap-x-6">
          {cursor ? (
            <Link
              href="/console/social/agents"
              className="inline-flex min-h-11 items-center underline"
            >
              Back to the newest
            </Link>
          ) : null}
          {page.next ? (
            <Link
              href={`/console/social/agents?after=${page.next}`}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Older agents
            </Link>
          ) : null}
        </p>
      ) : null}
    </Frame>
  );
}
