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

/** Opens Google's sign-in in the phone's browser and waits for the way back. */
export async function signInWithGoogle(): Promise<GoogleOutcome> {
  let url: string;
  try {
    const auth = await authClient();
    const { data, error } = await auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: GOOGLE_RETURN, skipBrowserRedirect: true },
    });
    if (error || !data.url) return 'failed';
    url = data.url;
  } catch {
    return 'failed';
  }
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(url, GOOGLE_RETURN);
  } catch {
    return 'failed'; // no browser that can open it (Android needs one with Custom Tabs)
  }
  if (result.type !== 'success') return 'cancelled';
  return finishGoogleSignIn(result.url);
}

const finishing = new Map<string, Promise<GoogleOutcome>>();
const listeners = new Set<(outcome: GoogleOutcome) => void>();

/**
 * Tells a screen how each way back from Google ended, including one the app was opened with
 * after Android had closed it, when no sign-in was waiting for it. Returns the way to stop.
 */
export function onGoogleOutcome(listener: (outcome: GoogleOutcome) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Trades the way back's one-time code for the session, once per code. The browser hands the
 * address to the app twice when the app is open (to the sign-in that's waiting, and to the
 * app's links, app/+native-intent.tsx), and once when Android had closed the app meanwhile (to
 * the links alone); either way it's finished exactly once.
 */
export function finishGoogleSignIn(address: string): Promise<GoogleOutcome> {
  const back = readGoogleReturn(address);
  if (back.kind !== 'code') {
    const outcome: GoogleOutcome = back.kind === 'refused' ? 'refused' : 'failed';
    for (const listener of listeners) listener(outcome);
    return Promise.resolve(outcome);
  }
  let job = finishing.get(back.code);
  if (!job) {
    job = authClient()
      .then(async (auth) => {
        const { error } = await auth.exchangeCodeForSession(back.code);
        return error ? 'failed' : 'signed-in';
      })
      .catch((): GoogleOutcome => 'failed')
      .then((outcome) => {
        for (const listener of listeners) listener(outcome);
        return outcome;
      });
    finishing.set(back.code, job);
  }
  return job;
}
