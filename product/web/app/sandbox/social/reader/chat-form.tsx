'use client';

import { useActionState, useRef, useState } from 'react';
import { FIELD } from '@/components/console/controls.tsx';
import { PRIMARY } from '@/components/sandbox/classes.ts';
import { sendMessage } from './actions.ts';
import type { Answer } from './answers.ts';

/**
 * The chat form (docs/social/r12-design.md, section 4.4): a message to the reader's own agent, up to 2,000
 * characters. It is the one place a reader's words can start an AI call, so the form is careful:
 *
 * - **One request ID for each message:** made with the form, and made again only after a definitive answer (the
 *   action says so: `final`). A thrown or network failure, and a 409 "still answering", keep the same ID, so the
 *   next press is a safe retry that never sends twice.
 * - **The button is disabled** while a message is on its way, and while chat is paused or the day's messages are
 *   used (`blocked` says why, in words, above the form). The text stays in the field after anything but a send that
 *   went through.
 *
 * A client component because the request ID and the text are this form's own state. Plain stock components. The
 * form has no box of its own on a phone, so the field keeps the whole width at 200% text.
 */
export function ChatForm({ blocked }: { blocked: string | null }) {
  const [text, setText] = useState('');
  // One request ID for each message: a second press on the same message never sends a second one.
  const request = useRef(crypto.randomUUID());

  const [answer, send, pending] = useActionState<Answer | null, FormData>(
    async (_previous, form) => {
      const body = String(form.get('body') ?? '');
      try {
        const result = await sendMessage(request.current, body);
        if (result.final) request.current = crypto.randomUUID();
        if (result.ok) setText('');
        return result;
      } catch {
        return {
          ok: false,
          message: "That didn't reach your reader agent: press Send again, it is safe to retry",
          issues: [],
          final: false,
        };
      }
    },
    null,
  );

  return (
    <form
      action={send}
      className="mt-6 grid max-w-xl grid-cols-1 gap-4 sm:rounded-md sm:border sm:border-line sm:p-4"
      data-testid="reader-chat-form"
    >
      <h2 className="text-xl font-semibold">Tell your reader agent what you want to read</h2>
      <div className="min-w-0">
        <label htmlFor="reader-message" className="font-medium">
          Your message
        </label>
        <textarea
          id="reader-message"
          name="body"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          rows={4}
          required
          className={FIELD}
        />
      </div>
      <button type="submit" disabled={pending || blocked !== null} className={PRIMARY}>
        Send
      </button>
      {pending ? (
        <p role="status" className="min-w-0 break-words" data-testid="reader-chat-waiting">
          Waiting for your reader agent
        </p>
      ) : null}
      {answer && !pending ? (
        <div
          role="status"
          data-testid="reader-chat-answer"
          data-ok={answer.ok ? 'true' : 'false'}
          className="min-w-0 rounded-md border border-line bg-note px-4 py-3 break-words"
        >
          <p>{answer.message}</p>
          {answer.issues.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
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
