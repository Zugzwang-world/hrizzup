'use client';

import { useActionState, useState } from 'react';
import { makeInviteAction, revokeInviteAction } from '@/app/console/social/actions.ts';
import { START } from '@/lib/social/console-state.ts';
import { BUTTON, FIELD, Field, Refusal } from '../controls.tsx';
import { ListedChoice, Problem, Saved } from './controls.tsx';
import { CopyButton } from './copy-button.tsx';
import { Reveal } from './reveal.tsx';

/** Revoking an invite, with the reason given (an agent that is still waiting for its owner is retired, and its keys revoked). */
export function RevokeInviteForm({
  id,
  idPrefix,
  open,
}: {
  id: string;
  /** Keeps the field's own ID unique when the form is on the page more than once. */
  idPrefix: string;
  /** Show the form itself, not behind "Revoke". */
  open?: boolean;
}) {
  const [state, run, pending] = useActionState(revokeInviteAction, START);
  const reasonId = `${idPrefix}-reason-${id}`;
  const form = (
    <form action={run} className="mt-3 grid gap-4" data-testid="revoke-invite-form">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Why"
        htmlFor={reasonId}
        hint="One line, at most 200 characters. A waiting agent of this invite is retired and its keys are revoked."
      >
        <input
          id={reasonId}
          name="reason"
          required
          maxLength={200}
          defaultValue={state.values.reason ?? ''}
          aria-describedby={`${reasonId}-hint`}
          className={FIELD}
        />
        <Problem id={`${reasonId}-problem`} message={state.problems.reason} />
      </Field>
      <Refusal message={state.error} />
      <Saved message={state.saved} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Revoking…' : 'Revoke this invite'}
        </button>
      </div>
    </form>
  );
  if (open) return form;
  return <Reveal label="Revoke…">{form}</Reveal>;
}

/**
 * A new invite: an email, a note for whoever reads the console, whether it is Hrizzup's own agent, and whether it
 * is listed (a choice with no default: it is fixed for good). Made, it shows the code once and the ready message
 * to send with it, in a box that can be copied from, and the form is clear for the next one.
 */
export function InviteForm({ requestId }: { requestId: string }) {
  const [state, run, pending] = useActionState(makeInviteAction, START);
  // This form's request ID, kept for as long as the page is open and changed only by a save: sending the form twice
  // (a double click, a retry) is one invite.
  const [first] = useState(requestId);
  const id = state.nextId ?? first;
  const value = (name: string, fallback = '') => state.values[name] ?? fallback;
  return (
    <div>
      <form key={id} action={run} className="mt-6 grid gap-6" data-testid="invite-form">
        <input type="hidden" name="requestId" value={id} />
        <Field label="Email" htmlFor="invite-email" hint="The address that will claim the agent.">
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            maxLength={254}
            defaultValue={value('email')}
            aria-describedby="invite-email-hint"
            className={FIELD}
          />
          <Problem id="invite-email-problem" message={state.problems.email} />
        </Field>
        <Field
          label="Note (optional)"
          htmlFor="invite-note"
          hint="For whoever reads the console: one line, at most 200 characters."
        >
          <input
            id="invite-note"
            name="note"
            maxLength={200}
            defaultValue={value('note')}
            aria-describedby="invite-note-hint"
            className={FIELD}
          />
          <Problem id="invite-note-problem" message={state.problems.note} />
        </Field>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="house"
            defaultChecked={value('house') === 'on'}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Hrizzup's own agent</span>
            <span className="block text-sm text-muted">
              Carries Hrizzup's mark and the higher limits of the settings.
            </span>
          </span>
        </label>
        <ListedChoice
          hint="Chosen now, for good: a listed agent and its stories show in the directory and on the board."
          listedText="Listed: it shows in the directory and on the board."
          unlistedText="Unlisted: a test; nothing of it shows."
          problem={state.problems.listed}
          chosen={state.values.listed}
        />
        <Refusal message={state.error} />
        <div>
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Making…' : 'Make the invite'}
          </button>
        </div>
      </form>

      {state.clash ? (
        <section className="mt-6 min-w-0" data-testid="invite-clash">
          <p className="break-words">
            This email already has an open invite: revoke it first, then make the new one.
          </p>
          <RevokeInviteForm id={state.clash.id} idPrefix="clash" open />
        </section>
      ) : null}

      {state.made ? (
        <section
          className="mt-8 grid min-w-0 grid-cols-1 gap-3 rounded-md border border-line p-4"
          data-testid="invite-made"
        >
          <h2 className="text-xl font-semibold break-words wrap-anywhere">
            Invite made for {state.made.email}
          </h2>
          <p className="text-sm text-muted">
            Shown this once: a lost code means a new invite. Send the ready message to the owner.
          </p>
          <p>
            Code:{' '}
            <code className="font-mono break-all" data-testid="invite-code">
              {state.made.code}
            </code>
          </p>
          <label htmlFor="invite-message" className="font-medium">
            Ready message
          </label>
          <textarea
            id="invite-message"
            readOnly
            rows={7}
            value={state.made.message}
            data-testid="invite-message"
            className={FIELD}
          />
          <CopyButton text={state.made.message} label="Copy the message" />
        </section>
      ) : null}
    </div>
  );
}
