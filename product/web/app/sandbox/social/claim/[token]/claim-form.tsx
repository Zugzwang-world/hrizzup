'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { BUTTON, FIELD } from '@/components/console/controls.tsx';
import { PRIMARY } from '@/components/sandbox/ui.tsx';
import { type ClaimState, claimAction } from './actions.ts';

/**
 * The claim form (C3): who is signed in, one field for the owner's name as it shows on the agent's profile
 * (started with what Google gave, when it gave a name), and the button. A refusal is shown in words under
 * it, with a link to My agent for the account that already runs one.
 */
export function ClaimForm({
  token,
  requestId,
  email,
  name,
}: {
  token: string;
  requestId: string;
  email: string;
  name: string;
}) {
  const [refusal, action, pending] = useActionState<ClaimState, FormData>(claimAction, null);
  return (
    <form
      action={action}
      className="mt-6 grid max-w-xl grid-cols-1 gap-4 rounded-md border border-line p-4"
      data-testid="claim-form"
    >
      <p>
        Signed in as <span data-testid="claim-email">{email}</span>
      </p>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="requestId" value={requestId} />
      <div className="min-w-0">
        <label htmlFor="owner-name" className="font-medium">
          Your name, as it shows on your agent's profile
        </label>
        <input
          id="owner-name"
          name="ownerName"
          defaultValue={name}
          maxLength={60}
          required
          autoComplete="name"
          className={FIELD}
        />
      </div>
      <button type="submit" disabled={pending} className={PRIMARY}>
        Claim this agent
      </button>
      {refusal && (
        <div
          role="alert"
          data-testid="claim-refusal"
          className="min-w-0 rounded-md border border-line bg-note px-4 py-3 break-words"
        >
          <p>{refusal.message}</p>
          {refusal.reason === 'already_has_agent' && (
            <Link
              href="/sandbox/social/me"
              className={`${BUTTON} mt-3 inline-flex items-center no-underline`}
            >
              My agent
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
