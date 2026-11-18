'use client';

import { useActionState, useState } from 'react';
import {
  saveStoryAction,
  saveUpdateAction,
  withdrawStoryAction,
} from '@/app/console/social/actions.ts';
import { START, sendId } from '@/lib/social/console-state.ts';
import { BUTTON, FIELD, Field, Refusal } from '../controls.tsx';
import { ListedChoice, Problem, Saved } from './controls.tsx';
import { Reveal } from './reveal.tsx';

type Named = { code: string; name: string };
/** The places by tier, each tier a group of the select. */
export type PlaceGroups = { tier: string; places: Named[] }[];

/** The first of three selects of one list: the main one is required, the other two may be left. */
function Chooser({
  prefix,
  label,
  groups,
  value,
}: {
  prefix: 'category' | 'place';
  label: string;
  groups: PlaceGroups;
  value: (name: string) => string;
}) {
  return (
    <>
      {[1, 2, 3].map((n) => (
        <label key={n} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:items-center">
          <span className="text-sm">
            {n === 1 ? `Main ${label}` : n === 2 ? 'Second (optional)' : 'Third (optional)'}
          </span>
          <select
            name={`${prefix}${n}`}
            required={n === 1}
            defaultValue={value(`${prefix}${n}`)}
            className={FIELD}
          >
            <option value="">{n === 1 ? 'Choose one' : 'None'}</option>
            {groups.map((group) =>
              group.tier ? (
                <optgroup key={group.tier} label={group.tier}>
                  {group.places.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                group.places.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))
              ),
            )}
          </select>
        </label>
      ))}
    </>
  );
}

/**
 * A new test story (staging only): the title and summary, one to three categories and places (the main one
 * first), and whether it is listed on the board (a choice with no default: it is fixed for good). Saved, it
 * shows the story's own page, where its updates are added.
 */
export function StoryForm({
  id,
  categories,
  places,
}: {
  /** The new story's ID, chosen as the form opens, so sending it twice makes one story. */
  id: string;
  categories: Named[];
  places: PlaceGroups;
}) {
  const [state, run, pending] = useActionState(saveStoryAction, START);
  const value = (name: string, fallback = '') => state.values[name] ?? fallback;
  return (
    <form action={run} className="mt-6 grid gap-6" data-testid="story-form">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Title"
        htmlFor="story-title"
        hint="The headline: one line, at most 120 characters."
      >
        <input
          id="story-title"
          name="title"
          required
          maxLength={120}
          defaultValue={value('title')}
          aria-describedby="story-title-hint"
          className={FIELD}
        />
        <Problem id="story-title-problem" message={state.problems.title} />
      </Field>
      <Field
        label="Summary"
        htmlFor="story-summary"
        hint="One or two sentences, at most 300 characters."
      >
        <textarea
          id="story-summary"
          name="summary"
          required
          maxLength={300}
          rows={3}
          defaultValue={value('summary')}
          aria-describedby="story-summary-hint"
          className={FIELD}
        />
        <Problem id="story-summary-problem" message={state.problems.summary} />
      </Field>
      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-medium">Categories</legend>
        <p className="text-sm text-muted">What it is about: one to three, the main one first.</p>
        <Chooser
          prefix="category"
          label="category"
          groups={[{ tier: '', places: categories }]}
          value={value}
        />
        <Problem id="story-categories-problem" message={state.problems.categories} />
      </fieldset>
      <fieldset className="grid min-w-0 gap-3">
        <legend className="font-medium">Places</legend>
        <p className="text-sm text-muted">Where it matters: one to three, the main one first.</p>
        <Chooser prefix="place" label="place" groups={places} value={value} />
        <Problem id="story-places-problem" message={state.problems.places} />
      </fieldset>
      <ListedChoice
        hint="Chosen now, for good: a listed story shows on the board."
        listedText="Listed: it shows on the board."
        unlistedText="Unlisted: a test; it never shows on the board."
        problem={state.problems.listed}
        chosen={state.values.listed}
      />
      <Refusal message={state.error} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Save the story'}
        </button>
      </div>
    </form>
  );
}

/**
 * A new update in a story's timeline: the headline, optional detail, the sources one to a line, and optionally the
 * earlier update it corrects. Saved, the form is clear for the next one, with a new ID of its own.
 */
export function UpdateForm({
  storyId,
  id,
  earlier,
}: {
  storyId: string;
  /** The update's ID, chosen as the form opens. */
  id: string;
  /** The story's updates so far, which one of the new may correct. */
  earlier: { id: string; headline: string }[];
}) {
  const [state, run, pending] = useActionState(saveUpdateAction, START);
  // The ID the last send carried until a save uses it up (`sendId`): sending the form twice is one update, and
  // an update after a save never carries the saved one's ID, a refused send between them or not.
  const [first] = useState(id);
  const own = sendId(state, 'id', first);
  const value = (name: string, fallback = '') => state.values[name] ?? fallback;
  return (
    <form key={own} action={run} className="mt-4 grid gap-6" data-testid="update-form">
      <input type="hidden" name="id" value={own} />
      <input type="hidden" name="storyId" value={storyId} />
      <Field
        label="Headline"
        htmlFor="update-headline"
        hint="What happened: one line, at most 120 characters."
      >
        <input
          id="update-headline"
          name="headline"
          required
          maxLength={120}
          defaultValue={value('headline')}
          aria-describedby="update-headline-hint"
          className={FIELD}
        />
        <Problem id="update-headline-problem" message={state.problems.headline} />
      </Field>
      <Field
        label="Detail (optional)"
        htmlFor="update-body"
        hint="More about it, at most 1,000 characters."
      >
        <textarea
          id="update-body"
          name="body"
          maxLength={1000}
          rows={3}
          defaultValue={value('body')}
          aria-describedby="update-body-hint"
          className={FIELD}
        />
        <Problem id="update-body-problem" message={state.problems.body} />
      </Field>
      <Field
        label="Sources"
        htmlFor="update-sources"
        hint="Web addresses starting https://, one to a line, not on X."
      >
        <textarea
          id="update-sources"
          name="sources"
          required
          rows={3}
          defaultValue={value('sources')}
          aria-describedby="update-sources-hint"
          className={FIELD}
        />
        <Problem id="update-sources-problem" message={state.problems.sources} />
      </Field>
      {earlier.length > 0 ? (
        <Field
          label="Corrects (optional)"
          htmlFor="update-corrects"
          hint="An earlier update of this story that this one puts right."
        >
          <select
            id="update-corrects"
            name="corrects"
            defaultValue={value('corrects')}
            aria-describedby="update-corrects-hint"
            className={FIELD}
          >
            <option value="">None</option>
            {earlier.map((update) => (
              <option key={update.id} value={update.id}>
                {update.headline}
              </option>
            ))}
          </select>
          <Problem id="update-corrects-problem" message={state.problems.corrects} />
        </Field>
      ) : null}
      <Refusal message={state.error} />
      <Saved message={state.saved} />
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Add the update'}
        </button>
      </div>
    </form>
  );
}

/**
 * Withdrawing a story, with the reason: it leaves the board (a listed one too) and its page says why. The reason is
 * kept in the story, and shown to anyone who opens its address.
 */
export function WithdrawForm({ id }: { id: string }) {
  const [state, run, pending] = useActionState(withdrawStoryAction, START);
  return (
    <Reveal label="Withdraw this story…">
      <form action={run} className="mt-3 grid gap-4" data-testid="withdraw-form">
        <input type="hidden" name="id" value={id} />
        <Field
          label="Why"
          htmlFor="withdraw-reason"
          hint="Shown to anyone who opens the story: one line, at most 200 characters."
        >
          <input
            id="withdraw-reason"
            name="reason"
            required
            maxLength={200}
            defaultValue={state.values.reason ?? ''}
            aria-describedby="withdraw-reason-hint"
            className={FIELD}
          />
          <Problem id="withdraw-reason-problem" message={state.problems.reason} />
        </Field>
        <Refusal message={state.error} />
        <div>
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Withdrawing…' : 'Withdraw this story'}
          </button>
        </div>
      </form>
    </Reveal>
  );
}
