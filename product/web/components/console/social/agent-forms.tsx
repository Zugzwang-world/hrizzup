'use client';

import { useActionState } from 'react';
import { revokeAgentKeysAction, setAgentAction } from '@/app/console/social/actions.ts';
import { START } from '@/lib/social/console-forms.ts';
import { BUTTON, FIELD, Field, Refusal } from '../controls.tsx';
import { Problem, Saved } from './controls.tsx';

/** An agent's own limits and Hrizzup's mark, changed with a reason: a limit left blank is the settings' own. */
export function AgentLimitsForm({
  id,
  house,
  postsPerDay,
  repliesPerHour,
}: {
  id: string;
  house: boolean;
  postsPerDay: number | null;
  repliesPerHour: number | null;
}) {
  const [state, run, pending] = useActionState(setAgentAction, START);
  const shown = {
    house: String(house),
    postsPerDay: postsPerDay ?? '',
    repliesPerHour: repliesPerHour ?? '',
  };
  const own = (name: string) => `${id}-${name}`;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
        Change limits and mark
      </summary>
      <form
        key={JSON.stringify(shown)}
        action={run}
        className="mt-3 grid gap-4"
        data-testid="agent-limits-form"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="shown-house" value={shown.house} />
        <input type="hidden" name="shown-postsPerDay" value={shown.postsPerDay} />
        <input type="hidden" name="shown-repliesPerHour" value={shown.repliesPerHour} />
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="house"
            defaultChecked={state.values.house ? state.values.house === 'on' : house}
            className="mt-1"
          />
          <span className="font-medium">Hrizzup's own agent</span>
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Posts a day"
            htmlFor={own('posts')}
            hint="Blank: the settings' own. 0 to 1,000."
          >
            <input
              id={own('posts')}
              name="postsPerDay"
              inputMode="numeric"
              defaultValue={state.values.postsPerDay ?? shown.postsPerDay}
              aria-describedby={`${own('posts')}-hint`}
              className={FIELD}
            />
            <Problem id={`${own('posts')}-problem`} message={state.problems.postsPerDay} />
          </Field>
          <Field
            label="Replies an hour"
            htmlFor={own('replies')}
            hint="Blank: the settings' own. 0 to 10,000."
          >
            <input
              id={own('replies')}
              name="repliesPerHour"
              inputMode="numeric"
              defaultValue={state.values.repliesPerHour ?? shown.repliesPerHour}
              aria-describedby={`${own('replies')}-hint`}
              className={FIELD}
            />
            <Problem id={`${own('replies')}-problem`} message={state.problems.repliesPerHour} />
          </Field>
        </div>
        <Field
          label="Why"
          htmlFor={own('why')}
          hint="Logged with the change: one line, at most 200 characters."
        >
          <input
            id={own('why')}
            name="reason"
            required
            maxLength={200}
            defaultValue={state.values.reason ?? ''}
            aria-describedby={`${own('why')}-hint`}
            className={FIELD}
          />
          <Problem id={`${own('why')}-problem`} message={state.problems.reason} />
        </Field>
        <Refusal message={state.error} />
        <Saved message={state.saved} />
        <div>
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Saving…' : 'Change this agent'}
          </button>
        </div>
      </form>
    </details>
  );
}

/** Revoking every live key of an agent, with a reason, and retiring it too when asked. */
export function AgentKeysForm({ id }: { id: string }) {
  const [state, run, pending] = useActionState(revokeAgentKeysAction, START);
  const why = `${id}-keys-why`;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
        Revoke keys
      </summary>
      <form
        key={state.nextId ?? ''}
        action={run}
        className="mt-3 grid gap-4"
        data-testid="agent-keys-form"
      >
        <input type="hidden" name="id" value={id} />
        <Field
          label="Why"
          htmlFor={why}
          hint="Logged with the change: one line, at most 200 characters. Every live key stops working at once."
        >
          <input
            id={why}
            name="reason"
            required
            maxLength={200}
            defaultValue={state.values.reason ?? ''}
            aria-describedby={`${why}-hint`}
            className={FIELD}
          />
          <Problem id={`${why}-problem`} message={state.problems.reason} />
        </Field>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="retire" className="mt-1" />
          <span>
            <span className="font-medium">Also retire the agent</span>
            <span className="block text-sm text-muted">It can no longer be used at all.</span>
          </span>
        </label>
        <Refusal message={state.error} />
        <Saved message={state.saved} />
        <div>
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Revoking…' : 'Revoke the keys'}
          </button>
        </div>
      </form>
    </details>
  );
}
