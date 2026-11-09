'use client';

import { useActionState } from 'react';
import {
  type ConsoleFormState,
  closeMarketAction,
  openMarketAction,
  settleMarketAction,
} from '@/app/console/actions.ts';
import { BUTTON, FIELD, Field, Refusal } from './controls.tsx';

const START: ConsoleFormState = { error: null, values: {} };

type Action = (before: ConsoleFormState, form: FormData) => Promise<ConsoleFormState>;

/** One step that needs no more than a click: open or close. */
function Step({
  id,
  action,
  label,
  hint,
}: {
  id: string;
  action: Action;
  label: string;
  hint: string;
}) {
  const [state, run, pending] = useActionState(action, START);
  return (
    <form action={run} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-muted">{hint}</p>
      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Working…' : label}
        </button>
      </div>
    </form>
  );
}

/** Settling a closed market by hand: the outcome, with its evidence. */
function Settle({ id }: { id: string }) {
  const [state, run, pending] = useActionState(settleMarketAction, START);
  const value = (name: string, fallback = '') => state.values[name] ?? fallback;
  const outcomes = [
    ['yes', 'Yes', 'Each Yes share pays Ṁ1.'],
    ['no', 'No', 'Each No share pays Ṁ1.'],
    [
      'probability',
      'At a set probability',
      'Each Yes share pays that much, each No share the rest.',
    ],
    [
      'cancel',
      'Cancel',
      "Only when it can't be settled fairly: everyone gets back what they put in.",
    ],
  ] as const;
  return (
    <form action={run} className="grid gap-6">
      <input type="hidden" name="id" value={id} />
      <fieldset className="grid min-w-0 gap-2">
        <legend className="font-medium">Outcome</legend>
        {outcomes.map(([code, name, note]) => (
          <label key={code} className="flex min-w-0 items-start gap-3">
            <input
              type="radio"
              name="outcome"
              value={code}
              required
              defaultChecked={value('outcome') === code}
              className="mt-1.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="font-medium">{name}</span>{' '}
              <span className="text-sm text-muted">{note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field
        label="Set probability (%)"
        htmlFor="settle-probability"
        hint="Only for a set probability: 1 to 99."
      >
        <input
          id="settle-probability"
          name="probability"
          inputMode="decimal"
          pattern="\d{1,2}(\.\d{1,6})?"
          defaultValue={value('probability')}
          aria-describedby="settle-probability-hint"
          className={FIELD}
        />
      </Field>
      <Field
        label="Evidence"
        htmlFor="evidence"
        hint="What the source said, and where and when it was read. At most 2,000 characters."
      >
        <textarea
          id="evidence"
          name="evidence"
          required
          maxLength={2000}
          rows={4}
          defaultValue={value('evidence')}
          aria-describedby="evidence-hint"
          className={FIELD}
        />
      </Field>
      <Field
        label="Why it's cancelled"
        htmlFor="reason"
        hint="Only for a cancel: one line, at most 200 characters, shown with the market."
      >
        <input
          id="reason"
          name="reason"
          maxLength={200}
          defaultValue={value('reason')}
          aria-describedby="reason-hint"
          className={FIELD}
        />
      </Field>
      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Settling…' : 'Settle the market'}
        </button>
      </div>
    </form>
  );
}

/** What an admin can do next, for the state the market is in. */
export function MarketActions({ id, state }: { id: string; state: string }) {
  if (state === 'draft') {
    return (
      <Step
        id={id}
        action={openMarketAction}
        label="Open the market"
        hint="Betting starts at once: its opening time becomes now, and the house puts in its seed."
      />
    );
  }
  if (state === 'open') {
    return (
      <Step
        id={id}
        action={closeMarketAction}
        label="Close the market"
        hint="Betting stops at once. Then settle it from its source."
      />
    );
  }
  if (state === 'closed') return <Settle id={id} />;
  return <p className="text-muted">Nothing more to do: it's {state}.</p>;
}
