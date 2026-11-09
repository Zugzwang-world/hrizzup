import type { Me } from '@hrizzup/api';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { EmailCodeRequest } from '@/components/email-code-request.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { whoAmI } from '@/lib/api/server.ts';
import {
  CODE_LENGTH,
  CODE_MINUTES,
  PENDING_COOKIE,
  type PendingCode,
  readPendingCookie,
} from '@/lib/email-code.ts';
import { currentEnvironment, signInTestEnabled } from '@/lib/env.ts';
import { supabaseConfig } from '@/lib/supabase/config.ts';

export const metadata: Metadata = {
  title: 'Sign-in test',
  robots: { index: false, follow: false },
};

const ERRORS: Record<string, string> = {
  start: "Google sign-in couldn't start. Try again.",
  refused: 'Sign-in was cancelled or refused.',
  'no-code': 'Google sent no sign-in code back.',
  exchange: "The sign-in code couldn't be used. Try again.",
  'not-configured': "Sign-in isn't set up in this environment.",
  relay: "Staging couldn't return you to this preview. Start again from the preview.",
  email: 'Enter a valid email address.',
  'bot-check': "The bot check didn't pass. Try again.",
  'too-many': 'Too many codes were asked for. Wait a minute, then try again.',
  send: "The code couldn't be sent. Try again.",
  'code-format': `Enter the ${CODE_LENGTH}-digit code from the email.`,
  'code-wrong': "That code didn't work. Check it and try again, or get a new code.",
  'code-expired': 'Your code has run out. Ask for a new one.',
  'verify-failed': "The code couldn't be checked just now. Try again.",
};

const SIGNED_IN_WITH: Record<Me['signedInWith'], string> = {
  google: 'Google',
  email: 'An email code',
  test_account: 'Test account (staging only)',
  other: 'Another way',
};

type Props = { searchParams: Promise<{ error?: string | string[] }> };

/**
 * A plain page for testing sign-in end to end on staging, previews and this Mac (runbook
 * step 9.6; PLAN.md step 1.6a): Google, and a code sent by email. There is no password field,
 * here or anywhere. It doesn't exist on production; the real sign-in screen comes from the
 * design chat.
 */
export default async function SignInTestPage({ searchParams }: Props) {
  if (!signInTestEnabled()) notFound();
  const { error } = await searchParams;
  const message =
    typeof error === 'string' && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;

  const configured = supabaseConfig() !== null;
  // Who is signed in comes through the typed API's `me`, called in process (lib/api/server.ts);
  // it checks the session's signature locally against the project's public key.
  const user = configured ? await whoAmI() : null;
  const pending = readPendingCookie((await cookies()).get(PENDING_COOKIE)?.value);
  const siteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-5xl leading-tight tracking-tight">Sign-in test</h1>
        <p className="mt-3 text-muted">
          For checking sign-in on {currentEnvironment()}: Google, and a code sent by email. This
          page doesn't exist on the live site.
        </p>

        {message && (
          <p role="alert" className="mt-8 rounded-md border border-line bg-note px-4 py-3">
            {message}
          </p>
        )}

        {!configured ? (
          <p className="mt-8 rounded-md border border-line px-4 py-3">
            Sign-in isn't set up in this environment yet.
          </p>
        ) : user ? (
          <section
            aria-labelledby="signed-in"
            className="mt-8 rounded-lg border border-line p-5 sm:p-6"
          >
            <h2 id="signed-in" className="text-xl font-semibold">
              You're signed in
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
              {user.name && (
                <>
                  <dt className="text-sm text-muted">Name</dt>
                  <dd className="min-w-0 break-words">{user.name}</dd>
                </>
              )}
              <dt className="text-sm text-muted">Email</dt>
              <dd className="min-w-0 break-words" data-testid="signed-in-email">
                {user.email}
              </dd>
              <dt className="text-sm text-muted">Signed in with</dt>
              <dd className="min-w-0 break-words">{SIGNED_IN_WITH[user.signedInWith]}</dd>
            </dl>
            <form action="/auth/sign-out" method="post" className="mt-6">
              <button
                type="submit"
                className="min-h-11 rounded-md border border-line px-5 font-medium hover:bg-note"
              >
                Sign out
              </button>
            </form>
          </section>
        ) : (
          <section
            aria-labelledby="signed-out"
            className="mt-8 rounded-lg border border-line p-5 sm:p-6"
          >
            <h2 id="signed-out" className="text-xl font-semibold">
              You're signed out
            </h2>
            <form action="/auth/google" method="post" className="mt-6">
              <input type="hidden" name="next" value="/sign-in-test" />
              <button
                type="submit"
                className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-md border border-line bg-white px-5 py-2 text-left font-medium text-[#1f1f1f] hover:bg-[#f2f2f2]"
              >
                <GoogleMark />
                <span className="min-w-0">Continue with Google</span>
              </button>
            </form>

            <h3 id="email-code" className="mt-8 border-t border-line pt-6 font-semibold">
              Or get a sign-in code by email
            </h3>
            {pending ? (
              <CodeStep pending={pending} />
            ) : siteKey ? (
              <EmailCodeRequest siteKey={siteKey} next="/sign-in-test" />
            ) : (
              <p className="mt-3 text-muted">Email codes aren't set up in this environment yet.</p>
            )}
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * The code step, once a code has been emailed: the code itself (the email carries nothing
 * else), or start again with another address or a new code.
 */
function CodeStep({ pending }: { pending: PendingCode }) {
  return (
    <>
      <p className="mt-3">
        We emailed a code to{' '}
        <strong className="break-words" data-testid="code-sent-to">
          {pending.email}
        </strong>
        . It has {CODE_LENGTH} digits and works for {CODE_MINUTES} minutes.
      </p>
      <form action="/auth/code/verify" method="post" className="mt-4 grid gap-3">
        <label htmlFor="sign-in-code" className="text-sm font-medium">
          Code
        </label>
        <input
          id="sign-in-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH + 4}
          required
          className="min-h-11 w-full min-w-0 rounded-md border border-line bg-transparent px-3 py-2 tracking-widest"
        />
        <button
          type="submit"
          className="min-h-11 justify-self-start rounded-md border border-line px-5 font-medium hover:bg-note"
        >
          Sign in
        </button>
      </form>
      <form action="/auth/code/cancel" method="post" className="mt-4">
        <button type="submit" className="min-h-11 text-left underline">
          Use another email, or get a new code
        </button>
      </form>
    </>
  );
}

/** Google's "G" mark, as Google's sign-in branding guidelines ask for. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
