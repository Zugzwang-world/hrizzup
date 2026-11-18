'use client';

import { useActionState } from 'react';
import { setSettingsAction } from '@/app/console/social/actions.ts';
import type { SettingRow } from '@/lib/social/console-settings.ts';
import { START } from '@/lib/social/console-state.ts';
import { BUTTON, FIELD, Field, Refusal } from '../controls.tsx';
import { Problem, Saved } from './controls.tsx';

/**
 * The settings, each a field with its range, filled with its value now. Only a setting typed differently from what
 * the page showed is sent as a change, so a page loaded before another admin's change can't quietly undo it, and
 * every change is logged with the reason given. Saved, the form starts again from the new values.
 */
export function SettingsForm({
  rows,
  current,
}: {
  rows: readonly SettingRow[];
  /** Each setting's value now, as text. */
  current: Record<string, string>;
}) {
  const [state, run, pending] = useActionState(setSettingsAction, START);
  // A change to the settings (this admin's or another's) starts the form again from the new values.
  const fresh = JSON.stringify(current);
  return (
    <form key={fresh} action={run} className="mt-4 grid gap-6" data-testid="settings-form">
      {rows.map((row) => (
        <input
          key={row.name}
          type="hidden"
          name={`shown-${row.name}`}
          value={current[row.name] ?? ''}
        />
      ))}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <Field
            key={row.name}
            label={row.label}
            htmlFor={`setting-${row.name}`}
            hint={row.range ? `${row.hint} ${capital(row.range)}.` : row.hint}
          >
            {row.kind === 'number' ? (
              <input
                id={`setting-${row.name}`}
                name={row.name}
                type="number"
                step="any"
                inputMode="decimal"
                required
                defaultValue={state.values[row.name] ?? current[row.name] ?? ''}
                aria-describedby={`setting-${row.name}-hint`}
                className={FIELD}
              />
            ) : (
              // A text setting's value (a model's name) can be longer than the field is wide, and one line
              // would cut it off at twice the text size: a box that wraps shows all of it.
              <textarea
                id={`setting-${row.name}`}
                name={row.name}
                rows={2}
                required
                defaultValue={state.values[row.name] ?? current[row.name] ?? ''}
                aria-describedby={`setting-${row.name}-hint`}
                className={FIELD}
              />
            )}
            <Problem id={`setting-${row.name}-problem`} message={state.problems[row.name]} />
          </Field>
        ))}
      </div>
      <Field
        label="Why"
        htmlFor="settings-reason"
        hint="Every change is logged with its reason: one line, at most 200 characters. The change log, reasons included, shows in the checks' public screenshots: write nothing private."
      >
        <input
          id="settings-reason"
          name="reason"
          required
          maxLength={200}
          defaultValue={state.values.reason ?? ''}
          aria-describedby="settings-reason-hint"
          className={FIELD}
        />
        <Problem id="settings-reason-problem" message={state.problems.reason} />
      </Field>
      <Refusal message={state.error} />
      <Saved message={state.saved} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Change the settings'}
        </button>
      </div>
    </form>
  );
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
