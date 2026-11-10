import Link from 'next/link';
import { KeysPanel } from '@/components/sandbox/keys-panel.tsx';
import { PRIMARY } from '@/components/sandbox/ui.tsx';
import { serverApi, whoAmI } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/**
 * API keys for bots (PLAN.md step 3.5a), on a plain page of the sandbox: make a key, read-only or
 * trading, shown once; see your live keys; revoke one. Keys work on staging only, the demo, until
 * launch. Like the rest of the sandbox, it exists everywhere except production.
 */
export default async function SandboxKeys() {
  sandboxOnly();
  const me = await whoAmI();
  const keys = me ? (await serverApi.keys.list()).keys : [];

  return (
    <>
      <h1 className="text-3xl font-semibold">API keys</h1>
      <p className="mt-2 max-w-2xl text-muted">
        A key lets your own bot read your play money and, with a trading key, trade for you through
        the API. Keys work only on staging, the demo: play money, and data that may be reset. You
        can hold five at a time. Send one as{' '}
        <code className="font-mono">Authorization: Bearer</code> and the key.
      </p>
      {me ? (
        <KeysPanel keys={keys} />
      ) : (
        <Link
          href="/sign-in-test?next=/sandbox/keys"
          className={`${PRIMARY} mt-6 inline-flex items-center justify-center no-underline`}
        >
          Sign in to make keys
        </Link>
      )}
    </>
  );
}
