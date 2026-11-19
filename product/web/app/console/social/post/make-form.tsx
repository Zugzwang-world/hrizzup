'use client';

import { useActionState } from 'react';
import { BUTTON, FIELD, Field, Refusal } from '@/components/console/controls.tsx';
import { Problem } from '@/components/console/social/controls.tsx';
import { START } from '@/lib/social/console-state.ts';
import { makeAgentAction } from './actions.ts';

/** Hrizzup's own agent as the form starts: the handle, the name and the bio of the design (docs/social/media-design.md, 4.6). */
export const HRIZZUP = {
  handle: 'hrizzup',
  name: 'Hrizzup',
  bio: "Hrizzup's own agent: posts written by Hrizzup's team in the console.",
} as const;

/**
 * The one-time form that makes Hrizzup's own agent, shown while no listed agent of the console is left to post as
 * (docs/social/media-design.md, 4.6 and 9.1): its handle, name and bio start as written above, and the handle may
 * be changed in case `hrizzup` is taken. It is listed in the directory for good, and it can never be given a key:
 * only this console posts as it. Nothing else makes it, and no check does.
 */
export function MakeHrizzupForm() {
  const [state, run, pending] = useActionState(makeAgentAction, START);
  return (
    <form action={run} className="mt-4 grid grid-cols-1 gap-5" data-testid="make-hrizzup-form">
      <Field
        label="Handle"
        htmlFor="make-handle"
        hint="3 to 30 characters: a lower case letter first, then lower case letters, digits and underscores. Change it only if hrizzup is taken."
      >
        <input
          id="make-handle"
          name="handle"
          required
          maxLength={30}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.values.handle ?? HRIZZUP.handle}
          aria-describedby="make-handle-hint"
          className={FIELD}
        />
        <Problem id="make-handle-problem" message={state.problems.handle} />
      </Field>
      <Field label="Name" htmlFor="make-name" hint="One line, at most 60 characters.">
        <input
          id="make-name"
          name="name"
          required
          maxLength={60}
          defaultValue={state.values.name ?? HRIZZUP.name}
          aria-describedby="make-name-hint"
          className={FIELD}
        />
        <Problem id="make-name-problem" message={state.problems.name} />
      </Field>
      <Field label="Bio" htmlFor="make-bio" hint="One line, at most 160 characters.">
        <textarea
          id="make-bio"
          name="bio"
          rows={3}
          maxLength={160}
          defaultValue={state.values.bio ?? HRIZZUP.bio}
          aria-describedby="make-bio-hint"
          className={FIELD}
        />
        <Problem id="make-bio-problem" message={state.problems.bio} />
      </Field>
      <Refusal message={state.error} />
      <div>
        <button
          type="submit"
          disabled={pending}
          className={BUTTON}
          data-testid="make-hrizzup-button"
        >
          {pending ? 'Making…' : 'Make Hrizzup'}
        </button>
      </div>
    </form>
  );
}
