'use client';

import { useActionState } from 'react';
import {
  type ConsoleFormState,
  setPerpModeAction,
  setPerpSettingsAction,
} from '@/app/console/actions.ts';
import { MODE_HINTS, MODE_NAMES } from '@/lib/console-format.ts';
import { BUTTON, FIELD, Field, Refusal } from './controls.tsx';

const START: ConsoleFormState = { error: null, values: {} };

/** Why: every rule change says why, and the log keeps it. */
function Reason({ id, value }: { id: string; value: string }) {
  return (
    <Field
      label="Why"
      htmlFor={id}
      hint="Every rule change is logged with its reason: one line, at most 300 characters."
    >
      <input
        id={id}
        name="reason"
        required
        maxLength={300}
        defaultValue={value}
        aria-describedby={`${id}-hint`}
        className={FIELD}
      />
    </Field>
  );
}

/** The off switch: Manifold's three trading modes, at once, with the reason in the log. */
export function PerpModeForm({ id, mode }: { id: string; mode: string }) {
  const [state, run, pending] = useActionState(setPerpModeAction, START);
  const chosen = state.values.mode ?? mode;
  return (
    <form action={run} className="grid gap-6" data-testid="perp-mode-form">
      <input type="hidden" name="id" value={id} />
      <fieldset className="grid min-w-0 gap-2">
        <legend className="font-medium">The off switch</legend>
        {(['enabled', 'reduce-only', 'halted'] as const).map((code) => (
          <label key={code} className="flex min-w-0 items-start gap-3">
            <input
              type="radio"
              name="mode"
              value={code}
              required
              defaultChecked={chosen === code}
              className="mt-1.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="font-medium">{MODE_NAMES[code]}</span>{' '}
              <span className="text-sm text-muted">{MODE_HINTS[code]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Reason id="mode-reason" value={state.values.reason ?? ''} />
      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Switching…' : 'Switch'}
        </button>
      </div>
    </form>
  );
}

/** One setting's field, filled with its value now. */
const SETTINGS: { name: string; label: string; hint: string }[] = [
  { name: 'maxLeverage', label: 'Most leverage', hint: '1 to 10 times (the cap is 10).' },
  {
    name: 'takerFeeBps',
    label: 'Opening fee (basis points)',
    hint: "Of the position's size; closing is free. At most 100 (1%).",
  },
  {
    name: 'takerFeeImpact',
    label: 'Size fee',
    hint: 'The extra for positions large beside the pool; 0 for the flat fee only. At most 100.',
  },
  {
    name: 'fundingPeriodMs',
    label: 'Funding period (milliseconds)',
    hint: '3,600,000 is an hour, the shortest.',
  },
  {
    name: 'fundingSensitivity',
    label: 'Funding sensitivity',
    hint: 'How fast funding grows as the sides grow lopsided (more than 0).',
  },
  {
    name: 'maxFundingRate',
    label: 'Most funding a period',
    hint: "As a share of the paying side's pool: more than 0 and less than 1.",
  },
  {
    name: 'maxPriceAgeMs',
    label: 'Oldest price allowed (milliseconds)',
    hint: 'Trading pauses until the next price once the price is older than this.',
  },
];

/** The settings an admin may change, each change in the log with the reason. */
export function PerpSettingsForm({
  id,
  settings,
}: {
  id: string;
  settings: Record<string, string>;
}) {
  const [state, run, pending] = useActionState(setPerpSettingsAction, START);
  return (
    <form action={run} className="grid gap-6" data-testid="perp-settings-form">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        {SETTINGS.map((setting) => (
          <Field
            key={setting.name}
            label={setting.label}
            htmlFor={`setting-${setting.name}`}
            hint={setting.hint}
          >
            <input
              id={`setting-${setting.name}`}
              name={setting.name}
              inputMode="decimal"
              required
              defaultValue={state.values[setting.name] ?? settings[setting.name] ?? ''}
              aria-describedby={`setting-${setting.name}-hint`}
              className={FIELD}
            />
          </Field>
        ))}
      </div>
      <Reason id="settings-reason" value={state.values.reason ?? ''} />
      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Change the settings'}
        </button>
      </div>
    </form>
  );
}
