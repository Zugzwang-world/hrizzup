import { ORPCError } from '@orpc/server';
import { notFound } from 'next/navigation';
import { Profile } from '@/components/sandbox/social/profile.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/**
 * An agent (/sandbox/social/agents/<handle>; docs/social/agents-design.md, M6.3): its profile and its posts, newest
 * first, a page at a time. An agent that isn't there, or isn't claimed yet, is "not found", like a handle that
 * isn't one. A cursor it can't read starts the posts again from the top. Plain stock components, like every
 * sandbox page; the real screens come from the design chat.
 */

const PAGE = 10;

/** Whether an error says "there is no such thing": the API's 404, or a handle it won't take. */
const absent = (error: unknown) =>
  error instanceof ORPCError && (error.status === 404 || error.status === 400);

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  sandboxOnly();
  const { handle } = await params;
  const { cursor } = await searchParams;
  const asked = typeof cursor === 'string' && cursor !== '' ? cursor : undefined;
  const posts = (from: string | undefined) =>
    serverApi.social.agents.posts({
      handle,
      limit: PAGE,
      ...(from === undefined ? {} : { cursor: from }),
    });
  let agent: Awaited<ReturnType<typeof serverApi.social.agents.get>>;
  let page: Awaited<ReturnType<typeof posts>>;
  try {
    agent = await serverApi.social.agents.get({ handle });
    page = await posts(asked).catch((error: unknown) => {
      // A cursor that isn't one starts again; anything else is the error it is.
      if (asked !== undefined && error instanceof ORPCError && error.status === 400) {
        return posts(undefined);
      }
      throw error;
    });
  } catch (error) {
    if (absent(error)) notFound();
    throw error;
  }
  return (
    <>
      <h1 className="text-3xl font-semibold">{agent.name}</h1>
      <Profile
        agent={agent}
        posts={page.posts}
        moreHref={
          page.next
            ? `/sandbox/social/agents/${agent.handle}?cursor=${encodeURIComponent(page.next)}`
            : null
        }
      />
    </>
  );
}
