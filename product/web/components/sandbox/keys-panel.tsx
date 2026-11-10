'use client';

import type { ApiKey, KeyScope } from '@hrizzup/api';
import { useState } from 'react';
import { createKeyAction, type KeyAnswer, revokeKeyAction } from '@/app/sandbox/actions.ts';
import { BUTTON, FIELD } from '@/components/console/controls.tsx';
import { Choice, PRIMARY } from './ui.tsx';

const SCOPES = [
  { value: 'read', text: 'Read only' },
  { value: 'trade', text: 'Trading' },
] as const satisfies readonly { value: KeyScope; text: string }[];

const SCOPE_NAMES: Record<KeyScope, string> = { read: 'Read only', trade: 'Trading' };

const when = (moment: string) =>
  new Date(moment).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });

/**
 * Making and revoking API keys for bots, from the browser's own fields and buttons: a name and
 * read-only or trading; the new key shown once; each live key with its first characters, when it
 * was made and last used, and Revoke.
 */
export function KeysPanel({ keys }: { keys: readonly ApiKey[] }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<KeyScope>('read');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<KeyAnswer | null>(null);

  async function make(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setAnswer(null);
    const result = await createKeyAction(name, scope);
    setAnswer(result);
    if (result.ok) setName('');
    setPending(false);
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Bots using it stop working at once.`)) return;
    setPending(true);
    setAnswer(await revokeKeyAction(key.id));
    setPending(false);
  }

  return (
    <>
      <form
        onSubmit={make}
        className="mt-6 grid max-w-xl grid-cols-1 gap-4 rounded-md border border-line p-4"
        data-testid="key-form"
      >
        <h2 className="text-xl font-semibold">Make a key</h2>
        <div className="min-w-0">
          <label htmlFor="key-name" className="font-medium">
            Name
          </label>
          <input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            className={FIELD}
          />
        </div>
        <div className="min-w-0">
          <p className="font-medium">What it may do</p>
          <p className="text-sm text-muted">
            Read only: your balance, positions and orders. Trading: those, and trading and the perp.
          </p>
          <div className="mt-2">
            <Choice label="What it may do" value={scope} options={SCOPES} onChange={setScope} />
          </div>
        </div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          Make key
        </button>
        {answer && (
          <div
            role="status"
            data-testid="key-answer"
            className="min-w-0 rounded-md border border-line bg-note px-4 py-3 break-words"
          >
            <p>{answer.message}</p>
            {answer.secret && (
              <code
                data-testid="key-secret"
                className="mt-2 block rounded-md border border-line bg-paper px-3 py-2 font-mono text-sm wrap-anywhere select-all"
              >
                {answer.secret}
              </code>
            )}
          </div>
        )}
      </form>

      <h2 className="mt-8 text-xl font-semibold">Your keys</h2>
      {keys.length === 0 ? (
        <p className="mt-2 text-muted" data-testid="key-list-empty">
          No keys yet.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="key-list">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
              <span className="min-w-0 flex-[1_1_14rem]">
                <span className="block font-medium break-words">{key.name}</span>
                <span className="block text-sm text-muted wrap-anywhere">
                  <code className="font-mono">{key.shown}…</code> · {SCOPE_NAMES[key.scope]} · made{' '}
                  {when(key.createdAt)} ·{' '}
                  {key.lastUsedAt ? `last used ${when(key.lastUsedAt)}` : 'never used'}
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
    </>
  );
}
