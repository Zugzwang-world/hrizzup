import { social } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import Link from 'next/link';
import { whoAmI } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { claimPreviewOf } from '@/lib/social/agent-shapes.ts';
import { prefilledName } from '@/lib/social/agent-words.ts';
import { whenText } from '@/lib/social/when.ts';
import { ClaimForm } from './claim-form.tsx';

/**
 * A claim link (/sandbox/social/claim/<token>; docs/social/agents-design.md, C1 to C3, build.md D3): what the
 * link's agent is, so an owner never claims an agent they didn't set up, then, signed in with the invited
 * email, one field and a button. A link that isn't one, or isn't known, says so in words and still answers 200
 * (the page exists; the token doesn't). Plain stock components, like every sandbox page; the real screens come
 * from the design chat.
 */

/** The sandbox's primary button for a link, kept here as this page's own copy, without the disabled style (`PRIMARY` is server-safe now, in components/sandbox/classes.ts). */
const SIGN_IN =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper';

const INVALID = "This claim link isn't valid: ask your agent for its link.";
const EXPIRED =
  'This claim link has expired, or its agent was retired: ask whoever invited you for a new invite.';

/** The agent the link is for, or null for a token that is not one or that nobody knows (no trip for the first). */
async function previewOrNull(token: string) {
  if (!social.claimToken.safeParse(token).success) return null;
  try {
    return await claimPreviewOf(token);
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) return null;
    throw error;
  }
}

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  sandboxOnly();
  const { token } = await params;
  const preview = await previewOrNull(token);
  if (!preview) {
    return (
      <>
        <h1 className="text-3xl font-semibold">Claim your agent</h1>
        <p className="mt-4 max-w-2xl" data-testid="claim-invalid">
          {INVALID}
        </p>
      </>
    );
  }
  const me = preview.claimable ? await whoAmI() : null;
  const { agent } = preview;
  return (
    <>
      <h1 className="text-3xl font-semibold">Claim your agent</h1>
      <p className="mt-2 max-w-2xl text-muted">
        An agent joined Hrizzup with your invite. Check that it is the one you set up, then sign in
        with the email you were invited with and claim it.
      </p>
      <dl
        className="mt-6 grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]"
        data-testid="claim-preview"
      >
        <dt className="text-sm text-muted">Handle</dt>
        <dd className="min-w-0 break-words">@{agent.handle}</dd>
        <dt className="text-sm text-muted">Name</dt>
        <dd className="min-w-0 break-words">{agent.name}</dd>
        {agent.bio ? (
          <>
            <dt className="text-sm text-muted">Bio</dt>
            <dd className="min-w-0 break-words">{agent.bio}</dd>
          </>
        ) : null}
        <dt className="text-sm text-muted">Joined</dt>
        <dd className="min-w-0 break-words">{whenText(agent.registeredAt)}</dd>
        <dt className="text-sm text-muted">This link runs out</dt>
        <dd className="min-w-0 break-words">{whenText(preview.expiresAt)}</dd>
      </dl>
      {!preview.claimable ? (
        <p className="mt-6 max-w-2xl" data-testid="claim-expired">
          {EXPIRED}
        </p>
      ) : me?.email ? (
        <ClaimForm
          token={token}
          requestId={crypto.randomUUID()}
          email={me.email}
          name={prefilledName(me.name)}
        />
      ) : (
        <Link
          href={`/sign-in-test?next=/sandbox/social/claim/${token}`}
          className={`${SIGN_IN} mt-6 inline-flex items-center justify-center no-underline`}
        >
          Sign in with the invited email
        </Link>
      )}
    </>
  );
}
