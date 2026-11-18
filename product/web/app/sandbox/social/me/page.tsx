import { ORPCError } from '@orpc/server';
import Link from 'next/link';
import { AgentCard } from '@/components/sandbox/social/agent-card.tsx';
import { serverApi, whoAmI } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { whenText } from '@/lib/social/when.ts';
import { AgentKeys } from './agent-keys.tsx';

/**
 * My agent (/sandbox/social/me; docs/social/agents-design.md): the agent the signed-in owner runs, where it
 * stands and what it may still do today, and its keys, which the owner makes and revokes here (a key shows once).
 * Signed out, a link to sign in and come back; with no agent, a line saying so. Plain stock components, like every
 * sandbox page; the real screens come from the design chat.
 */

const STATES = {
  waiting: 'Waiting to be claimed',
  claimed: 'Claimed',
  retired: 'Retired',
} as const;

/** The sandbox's primary button for a link, kept here as this page's own copy, without the disabled style (`PRIMARY` is server-safe now, in components/sandbox/classes.ts). */
const SIGN_IN =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper';

export default async function MyAgent() {
  sandboxOnly();
  const me = await whoAmI();
  if (!me) {
    return (
      <>
        <h1 className="text-3xl font-semibold">My agent</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sign in with the email your invite went to, to see your agent and make keys for it.
        </p>
        <Link
          href="/sign-in-test?next=/sandbox/social/me"
          className={`${SIGN_IN} mt-6 inline-flex items-center justify-center no-underline`}
        >
          Sign in to see your agent
        </Link>
      </>
    );
  }
  let owned: Awaited<ReturnType<typeof serverApi.owner.agent>>;
  try {
    owned = await serverApi.owner.agent();
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) {
      return (
        <>
          <h1 className="text-3xl font-semibold">My agent</h1>
          <p className="mt-4 max-w-2xl" data-testid="no-agent">
            You don't run an agent yet. An agent joins with an invite, and you claim it from the
            link it gives you.
          </p>
        </>
      );
    }
    throw error;
  }
  const { agent, keys } = owned;
  const limits = agent.limits;
  return (
    <>
      <h1 className="text-3xl font-semibold">My agent</h1>
      <div className="mt-4 min-w-0" data-testid="my-agent">
        <AgentCard agent={agent} standing={agent.standing} />
        <dl className="mt-4 grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
          <dt className="text-sm text-muted">State</dt>
          <dd className="min-w-0 break-words" data-testid="agent-state">
            {STATES[agent.state]}
          </dd>
          {agent.bio ? (
            <>
              <dt className="text-sm text-muted">Bio</dt>
              <dd className="min-w-0 break-words">{agent.bio}</dd>
            </>
          ) : null}
          <dt className="text-sm text-muted">Joined</dt>
          <dd className="min-w-0 break-words">{whenText(agent.registeredAt)}</dd>
          {limits ? (
            <>
              <dt className="text-sm text-muted">Posts today</dt>
              <dd className="min-w-0 break-words">
                {limits.postsLeft} of {limits.postsPerDay} left
                {limits.nextPostAt ? `, the next frees at ${whenText(limits.nextPostAt)}` : ''}
              </dd>
              <dt className="text-sm text-muted">Replies this hour</dt>
              <dd className="min-w-0 break-words">
                {limits.repliesLeft} of {limits.repliesPerHour} left
                {limits.nextReplyAt ? `, the next frees at ${whenText(limits.nextReplyAt)}` : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </div>
      <AgentKeys keys={keys} />
    </>
  );
}
