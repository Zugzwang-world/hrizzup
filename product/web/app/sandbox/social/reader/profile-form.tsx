'use client';

import { useActionState, useRef, useState } from 'react';
import { FIELD } from '@/components/console/controls.tsx';
import { PRIMARY } from '@/components/sandbox/classes.ts';
import { saveProfile } from './actions.ts';
import type { Answer } from './answers.ts';

/**
 * The reading profile's form (docs/social/r12-design.md, section 4.4): the profile as markdown with its three
 * headings (More of, Less of, Formats), which the reader may edit by hand. Save sends it through the API's own
 * `reader.saveProfile`, which reads it leniently and writes it in its one stored form, and the field then holds that
 * canonical text. A profile that can't be read comes back as a list of issues, each naming its line, and nothing is
 * saved. The request ID is made with the form and made again only after a definitive answer, as the chat form's.
 *
 * A client component: the text and the request ID are this form's own state. When the stored profile changes
 * under the form (the reader agent edited it, in the chat), the field takes the new text; otherwise it keeps
 * whatever is being typed. Plain stock components; `grid-cols-1`, so the field keeps the whole width at 200% text.
 */
type Saved = Answer & { profile: string | null };

export function ProfileForm({ profile }: { profile: string }) {
  const [text, setText] = useState(profile);
  const [seen, setSeen] = useState(profile);
  // The stored profile changed (the agent's edit, a save): the field shows it, once.
  if (profile !== seen) {
    setSeen(profile);
    setText(profile);
  }
  const request = useRef(crypto.randomUUID());

  const [answer, save, pending] = useActionState<Saved | null, FormData>(
    async (_previous, form) => {
      const body = String(form.get('profile') ?? '');
      try {
        const result = await saveProfile(request.current, body);
        if (result.final) request.current = crypto.randomUUID();
        if (result.ok && result.profile !== null) setText(result.profile);
        return result;
      } catch {
        return {
          ok: false,
          message: "That didn't reach us: press Save again, it is safe to retry",
          issues: [],
          final: false,
          profile: null,
        };
      }
    },
    null,
  );

  return (
    <form
      action={save}
      className="mt-6 grid max-w-xl grid-cols-1 gap-4 sm:rounded-md sm:border sm:border-line sm:p-4"
      data-testid="reader-profile-form"
    >
      <h2 className="text-xl font-semibold">Your reading profile</h2>
      <p className="text-sm text-muted">
        Three lists, one item to a line, each starting with "- ": what you want more of, less of,
        and the formats you like (a timeline, a meme). Your reader agent edits it too. Stories that
        match "Less of" are left out of your For You.
      </p>
      <div className="min-w-0">
        <label htmlFor="reader-profile" className="font-medium">
          Reading profile
        </label>
        <textarea
          id="reader-profile"
          name="profile"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={14}
          className={`${FIELD} font-mono text-sm`}
        />
      </div>
      <button type="submit" disabled={pending} className={PRIMARY}>
        Save
      </button>
      {answer && !pending ? (
        <div
          role="status"
          data-testid="reader-profile-answer"
          data-ok={answer.ok ? 'true' : 'false'}
          className="min-w-0 rounded-md border border-line bg-note px-4 py-3 break-words"
        >
          <p>{answer.message}</p>
          {answer.issues.length > 0 ? (
            <ul className="mt-2 list-disc pl-5" data-testid="reader-profile-issues">
              {answer.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
