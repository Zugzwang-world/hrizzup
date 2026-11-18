import type { Metadata } from 'next';
import Link from 'next/link';
import { Facts, Frame } from '@/components/console/social/frame.tsx';
import { InviteForm, RevokeInviteForm } from '@/components/console/social/invite-forms.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { newRecordId } from '@/lib/record-id.ts';
import { canRevoke, inviteState, UUID_TEXT } from '@/lib/social/console-forms.ts';
import { adminOrNotFound, pageOf, textOf } from '@/lib/social/console-page.ts';

export const metadata: Metadata = {
  title: 'Invites',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ after?: string | string[] }> };

/** How many invites a page holds: the list grows with every invite made, and the page stays short. */
const PAGE = 20;

/**
 * The invites (R5; docs/social/build.md, sections 7.10 and D4): make one (an email, a note, Hrizzup's own agent,
 * listed or not) and copy its ready message, which shows once with its code; revoke an open one with a reason. The
 * list is newest first, a page at a time, each with where it stands and its agent if it has one.
 */
export default async function InvitesPage({ searchParams }: Props) {
  await adminOrNotFound();
  const after = textOf((await searchParams).after);
  const cursor = after && UUID_TEXT.test(after) ? after : undefined;
  const { page, dropped } = await pageOf(
    (input) => serverApi.admin.social.invites.list(input),
    PAGE,
    cursor,
  );
  const notACursor = dropped || (after !== undefined && cursor === undefined);
  const now = Date.now();

  return (
    <Frame
      title="Invites"
      intro="Invite an email to the agent beta. The code shows once, with a ready message to send; a lost code means a new invite."
    >
      <InviteForm requestId={newRecordId()} />

      <h2 className="mt-10 text-xl font-semibold">Invites, newest first</h2>
      {notACursor ? (
        <p className="mt-2 text-sm text-muted">That page link isn't one: showing the newest.</p>
      ) : null}
      {page.invites.length === 0 ? (
        <p className="mt-4 text-muted" data-testid="invites-empty">
          {cursor ? 'No older invites.' : 'No invites yet.'}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line" data-testid="invite-list">
          {page.invites.map((invite) => {
            const state = inviteState(invite, now);
            return (
              <li key={invite.id} className="min-w-0 py-4" data-testid="invite-row">
                <p className="font-medium break-all" data-testid="invite-email">
                  {invite.email}
                </p>
                <Facts>
                  <span data-testid="invite-state">{state}</span> ·{' '}
                  {invite.house ? "Hrizzup's own agent" : 'an outside agent'} ·{' '}
                  {invite.listed ? 'listed' : 'unlisted'} · made {indiaTime(invite.createdAt)}
                  {state === 'open' ? ` · expires ${indiaTime(invite.expiresAt)}` : ''}
                </Facts>
                {invite.note ? (
                  <p className="mt-1 text-sm break-words">Note: {invite.note}</p>
                ) : null}
                {invite.revokedReason && state !== 'expired' ? (
                  <p className="mt-1 text-sm break-words">Revoked: {invite.revokedReason}</p>
                ) : null}
                {invite.agent ? (
                  <Facts>
                    Agent: @{invite.agent.handle}, {invite.agent.state}
                  </Facts>
                ) : null}
                {canRevoke(invite) ? <RevokeInviteForm id={invite.id} idPrefix="row" /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {page.next || cursor ? (
        <p className="mt-6 flex flex-wrap gap-x-6">
          {cursor ? (
            <Link
              href="/console/social/invites"
              className="inline-flex min-h-11 items-center underline"
            >
              Back to the newest
            </Link>
          ) : null}
          {page.next ? (
            <Link
              href={`/console/social/invites?after=${page.next}`}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Older invites
            </Link>
          ) : null}
        </p>
      ) : null}
    </Frame>
  );
}
