import type { Session } from '@supabase/auth-js';
import { useSyncExternalStore } from 'react';
import { forgetPersonalAnswers } from '../api.ts';
import { authClient } from './client.ts';

/**
 * Whether someone is signed in, for the app's screens: Supabase's own news of the session (signed
 * in, refreshed, signed out), kept in one place every screen reads (PLAN.md step 1.6b).
 */
export type SignIn =
  /** The session on the phone is being read (or the settings fetched): only at start. */
  | { state: 'checking' }
  /** Sign-in can't be reached: the app couldn't get its settings from our API. */
  | { state: 'unavailable' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; session: Session };

let current: SignIn = { state: 'checking' };
const listeners = new Set<() => void>();
let following = false;

function set(next: SignIn) {
  current = next;
  for (const listener of listeners) listener();
}

/** Starts following Supabase's news of the session (once; again after it couldn't start). */
function follow() {
  if (following) return;
  following = true;
  authClient().then(
    (auth) => {
      auth.onAuthStateChange((_event, session) => {
        const before = current.state === 'signed-in' ? current.session.user.id : null;
        // Signed out, or someone else signed in: nothing personal stays in memory.
        if (before && before !== session?.user.id) forgetPersonalAnswers();
        set(session ? { state: 'signed-in', session } : { state: 'signed-out' });
      });
    },
    () => {
      following = false;
      set({ state: 'unavailable' });
    },
  );
}

/** A screen starts listening: the first one starts following the session too, outside render. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  follow();
  return () => listeners.delete(listener);
}

/** Who is signed in on this phone, kept current. */
export function useSignIn(): SignIn {
  return useSyncExternalStore(subscribe, () => current);
}

/** Tries again after sign-in couldn't be reached. */
export function retrySignIn() {
  set({ state: 'checking' });
  follow();
}

/**
 * Signs this phone out: Supabase ends this session (others, on the website or another phone,
 * stay signed in) and the session leaves the phone. False if Supabase couldn't be reached, in
 * which case the person is still signed in and can try again.
 */
export async function signOut(): Promise<boolean> {
  try {
    const { error } = await (await authClient()).signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}
