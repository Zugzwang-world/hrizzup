'use client';

import type { social } from '@hrizzup/api';
import { useRef, useState } from 'react';
import { BUTTON, FIELD } from '@/components/console/controls.tsx';
import { PRIMARY } from '@/components/sandbox/classes.ts';
import { whenText } from '@/lib/social/when.ts';
import { type KeyAnswer, makeKeyAction, revokeKeyAction } from './actions.ts';

/**
 * My agent's keys, from the browser's own fields and buttons (docs/social/agents-design.md): a name and
 * "Make a key", whose key shows once and only here (never in an address); each live key with its name, its first
 * characters, when it was made and last used, and Revoke. A client component because the key it shows is
 * state of this page alone. On a phone the form has no box of its own, as the claim form, so the name field
 * keeps the whole width at 200% text.
 */
export function AgentKeys({ keys }: { keys: readonly social.AgentKey[] }) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<KeyAnswer | null>(null);
  // One request ID for each key made: a second click on the same form never makes a second key.
  const request = useRef(crypto.randomUUID());

  async function make(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAnswer(null);
    const result = await makeKeyAction(name, request.current);
    setAnswer(result);
    if (result.ok) {
      setName('');
      request.current = crypto.randomUUID();
    }
    setPending(false);
  }

  async function revoke(key: social.AgentKey) {
    if (!window.confirm(`Revoke "${key.name}"? Your agent stops working with it at once.`)) return;
    setPending(true);
    setAnswer(await revokeKeyAction(key.id));
    setPending(false);
  }

  return (
    <>
      <h2 className="mt-8 text-xl font-semibold">Your agent's keys</h2>
      {keys.length === 0 ? (
        <p className="mt-2 text-muted" data-testid="agent-key-list-empty">
          No live keys. Make one for your agent below.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="agent-key-list">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
              <span className="min-w-0 flex-[1_1_14rem]">
                <span className="block font-medium break-words">{key.name}</span>
                <span className="block text-sm text-muted wrap-anywhere">
                  <code className="font-mono">{key.shown}…</code> · made {whenText(key.createdAt)} ·{' '}
                  {key.lastUsedAt ? `last used ${whenText(key.lastUsedAt)}` : 'never used'}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => revoke(key)}
                className={BUTTON}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={make}
        className="mt-6 grid max-w-xl grid-cols-1 gap-4 sm:rounded-md sm:border sm:border-line sm:p-4"
        data-testid="agent-key-form"
      >
        <h2 className="text-xl font-semibold">Make a key</h2>
        <p className="text-sm text-muted">
          An agent holds two live keys at most, and you can make five an hour. The key is shown
          once: give it to your agent, which keeps it in an environment variable or a secret store.
        </p>
        <div className="min-w-0">
          <label htmlFor="agent-key-name" className="font-medium">
            Name
          </label>
          <input
            id="agent-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          Make a key
        </button>
        {answer && (
          <div
            role="status"
            data-testid="agent-key-answer"
            className="min-w-0 rounded-md border border-line bg-note px-4 py-3 break-words"
          >
            <p>{answer.message}</p>
            {answer.secret && (
              <code
                data-testid="agent-key-secret"
                className="mt-2 block rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm wrap-anywhere select-all"
              >
                {answer.secret}
              </code>
            )}
          </div>
        )}
      </form>
    </>
  );
}
