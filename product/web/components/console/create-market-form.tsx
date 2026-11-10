'use client';

import { useActionState } from 'react';
import { type ConsoleFormState, createMarketAction } from '@/app/console/actions.ts';
import { BUTTON, FIELD, Field, Refusal } from './controls.tsx';

type Props = {
  /** The new market's ID, chosen as the form opens, so sending it twice makes one market. */
  id: string;
  categories: readonly { code: string; name: string }[];
  /** The fields' starting times, in India time (`2026-11-10T18:00`). */
  opensAt: string;
  closesAt: string;
};

/**
 * A moment typed in India time, as a date and a time: two of the browser's own fields, each short
 * enough to fit a small phone with its text at twice the size (one date-and-time field doesn't,
 * in Safari's engine).
 */
function Moment({
  name,
  label,
  hint,
  value,
  start,
}: {
  name: string;
  label: string;
  hint: string;
  value: (name: string, fallback?: string) => string;
  start: string;
}) {
  const [date = '', time = ''] = start.split('T');
  return (
    <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2" aria-describedby={`${name}-hint`}>
      <legend className="font-medium">{label}</legend>
      <p id={`${name}-hint`} className="text-sm text-muted sm:col-span-2">
        {hint}
      </p>
      <label className="grid min-w-0 gap-1">
        <span className="text-sm">Date</span>
        <input
          name={`${name}Date`}
          type="date"
          required
          defaultValue={value(`${name}Date`, date)}
          className={FIELD}
        />
      </label>
      <label className="grid min-w-0 gap-1">
        <span className="text-sm">Time</span>
        <input
          name={`${name}Time`}
          type="time"
          required
          defaultValue={value(`${name}Time`, time)}
          className={FIELD}
        />
      </label>
    </fieldset>
  );
}

const START: ConsoleFormState = { error: null, values: {} };

/** A new yes-or-no market, made as a draft: no money moves until an admin opens it. */
export function CreateMarketForm({ id, categories, opensAt, closesAt }: Props) {
  const [state, action, pending] = useActionState(createMarketAction, START);
  const value = (name: string, fallback = '') => state.values[name] ?? fallback;
  const choices = (blank: string) => (
    <>
      <option value="">{blank}</option>
      {categories.map((category) => (
        <option key={category.code} value={category.code}>
          {category.name}
        </option>
      ))}
    </>
  );

  return (
    <form action={action} className="mt-6 grid gap-6">
      <input type="hidden" name="id" value={id} />
      <Field label="Question" htmlFor="question" hint="One line, at most 120 characters.">
        <input
          id="question"
          name="question"
          required
          maxLength={120}
          defaultValue={value('question')}
          aria-describedby="question-hint"
          className={FIELD}
        />
      </Field>

      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-medium">Categories</legend>
        <p className="text-sm text-muted">
          The news shown alongside the market: one to three, the main one first.
        </p>
        <label className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
          <span className="text-sm">Main category</span>
          <select name="category1" required defaultValue={value('category1')} className={FIELD}>
            {choices('Choose one')}
          </select>
        </label>
        <label className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
          <span className="text-sm">Second (optional)</span>
          <select name="category2" defaultValue={value('category2')} className={FIELD}>
            {choices('None')}
          </select>
        </label>
        <label className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
          <span className="text-sm">Third (optional)</span>
          <select name="category3" defaultValue={value('category3')} className={FIELD}>
            {choices('None')}
          </select>
        </label>
      </fieldset>

      <Field
        label="Rules"
        htmlFor="rules"
        hint="How it settles, in plain words: what makes Yes or No win, what is read from the source and when, and when it's cancelled instead. At most 2,000 characters."
      >
        <textarea
          id="rules"
          name="rules"
          required
          maxLength={2000}
          rows={6}
          defaultValue={value('rules')}
          aria-describedby="rules-hint"
          className={FIELD}
        />
      </Field>

      <Field
        label="Settlement source"
        htmlFor="sourceName"
        hint="Its name, as shown with the market."
      >
        <input
          id="sourceName"
          name="sourceName"
          required
          maxLength={120}
          defaultValue={value('sourceName')}
          aria-describedby="sourceName-hint"
          className={FIELD}
        />
      </Field>
      <Field
        label="Source's address (optional)"
        htmlFor="sourceUrl"
        hint="Where anyone can check it, starting https://."
      >
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          maxLength={2048}
          defaultValue={value('sourceUrl')}
          aria-describedby="sourceUrl-hint"
          className={FIELD}
        />
      </Field>

      <Moment
        name="opens"
        label="Opens"
        hint="India time. Opening it starts betting at once; this is the plan."
        value={value}
        start={opensAt}
      />
      <Moment
        name="closes"
        label="Closes"
        hint="India time: when betting stops."
        value={value}
        start={closesAt}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Starting probability (%)" htmlFor="probability" hint="1 to 99.">
          <input
            id="probability"
            name="probability"
            inputMode="decimal"
            required
            pattern="\d{1,2}(\.\d{1,6})?"
            defaultValue={value('probability', '50')}
            aria-describedby="probability-hint"
            className={FIELD}
          />
        </Field>
        <Field
          label="The house's seed (Ṁ)"
          htmlFor="seed"
          hint="Play money the house puts in as it opens."
        >
          <input
            id="seed"
            name="seed"
            inputMode="decimal"
            required
            pattern="\d{1,7}(\.\d{1,6})?"
            defaultValue={value('seed', '1000')}
            aria-describedby="seed-hint"
            className={FIELD}
          />
        </Field>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="unlisted"
          defaultChecked={value('unlisted') === 'on'}
          aria-describedby="unlisted-hint"
          className="mt-1"
        />
        <span>
          <span className="font-medium">Keep it off the public list</span>
          <span id="unlisted-hint" className="block text-sm text-muted">
            A test market: traded and settled like any other by its address, but never listed.
            Chosen now, for good.
          </span>
        </span>
      </label>

      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Creating…' : 'Create the draft'}
        </button>
      </div>
    </form>
  );
}
