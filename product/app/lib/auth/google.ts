import * as WebBrowser from 'expo-web-browser';
import { authClient } from './client.ts';
import { GOOGLE_RETURN, readGoogleReturn } from './google-return.ts';

/**
 * "Continue with Google" in the app (PLAN.md step 1.6b): through the phone's browser, never a web
 * view inside the app, as Google requires and the standard for apps (OAuth 2.0 for native apps,
 * RFC 8252) advises. The same Google setup as the website: Supabase's Google sign-in opens in a
 * browser tab (Chrome's Custom Tabs on Android), Google answers Supabase, and Supabase sends the
 * browser to the app's own address (`GOOGLE_RETURN`) with a one-time code, which the app trades
 * for its session with the verifier only it holds (PKCE). No Google module in the app, and
 * nothing for anyone to set up but the address on Supabase's allow-list.
 */

export type GoogleOutcome = 'signed-in' | 'cancelled' | 'refused' | 'failed';

/** A sign-in waiting for its way back, while the browser is open. */
let waiting = false;

/** Opens Google's sign-in in the phone's browser and waits for the way back. */
export async function signInWithGoogle(): Promise<GoogleOutcome> {
  let url: string;
  let flowId: string | null | undefined;
  try {
    const auth = await authClient();
    const { data, error } = await auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: GOOGLE_RETURN, skipBrowserRedirect: true },
    });
    if (error || !data.url) return tell('failed');
    // Only a SHA-256 challenge (S256): Supabase's client falls back to sending the verifier
    // itself ("plain") where the phone has no Web Crypto, and that never leaves the app.
    if (new URL(data.url).searchParams.get('code_challenge_method')?.toLowerCase() !== 's256') {
      return tell('failed');
    }
    url = data.url;
    flowId = data.flowId;
  } catch {
    return tell('failed');
  }
  let result: WebBrowser.WebBrowserAuthSessionResult;
  waiting = true;
  try {
    result = await WebBrowser.openAuthSessionAsync(url, GOOGLE_RETURN);
  } catch {
    return tell('failed'); // no browser that can open it (Android needs one with Custom Tabs)
  } finally {
    waiting = false;
  }
  if (result.type !== 'success') return tell('cancelled');
  return finishGoogleSignIn(result.url, flowId);
}

const finishing = new Map<string, Promise<GoogleOutcome>>();
const listeners = new Set<(outcome: GoogleOutcome) => void>();
let last: { outcome: GoogleOutcome; at: number } | null = null;

/** Tells every screen listening how a sign-in ended, and keeps it for one that opens later. */
function tell(outcome: GoogleOutcome): GoogleOutcome {
  last = { outcome, at: Date.now() };
  for (const listener of listeners) listener(outcome);
  return outcome;
}

/**
 * Tells a screen how each sign-in with Google ends, including one the app was opened with after
 * Android had closed it, which may end before the screen is there: the last outcome of the past
 * minute is told at once. Returns the way to stop.
 */
export function onGoogleOutcome(listener: (outcome: GoogleOutcome) => void): () => void {
  listeners.add(listener);
  if (last && Date.now() - last.at < 60_000) listener(last.outcome);
  return () => listeners.delete(listener);
}

/**
 * The way back, when it reaches the app's links (app/+native-intent.tsx): finished there only
 * when no sign-in is waiting for it, that is, when Android had closed the app while the browser
 * was open. A sign-in that's waiting gets the same address itself, and finishes it with its own
 * flow, so an address another app sends meanwhile can't spend that flow's verifier.
 */
export function finishGoogleReturn(address: string): void {
  if (!waiting) void finishGoogleSignIn(address);
}

/**
 * Trades the way back's one-time code for the session, once per code, with the sign-in's own flow
 * when it's known (the verifier saved for it).
 */
function finishGoogleSignIn(address: string, flowId?: string | null): Promise<GoogleOutcome> {
  const back = readGoogleReturn(address);
  if (back.kind !== 'code')
    return Promise.resolve(tell(back.kind === 'refused' ? 'refused' : 'failed'));
  let job = finishing.get(back.code);
  if (!job) {
    job = authClient()
      .then(async (auth) => {
        const { error } = await auth.exchangeCodeForSession(
          back.code,
          flowId ? { flowId } : undefined,
        );
        return error ? 'failed' : 'signed-in';
      })
      .catch((): GoogleOutcome => 'failed')
      .then(tell);
    finishing.set(back.code, job);
  }
  return job;
}
