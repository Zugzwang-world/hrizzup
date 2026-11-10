import '../crypto.ts';
import { GoTrueClient } from '@supabase/auth-js';
import { AppState } from 'react-native';
import { api, sendTokensFrom } from '../api.ts';
import { sessionStorage } from './storage.ts';

/**
 * The app's sign-in client: Supabase Auth, on the same accounts as the website (PLAN.md step 1.6b).
 *
 * - **Its settings come from our API** (`auth.settings`): Supabase's address and publishable key,
 *   which is public by design. Nothing is built into the app, so no key lives in the repository or
 *   in a build; each environment's come from Doppler, as the website's do.
 * - **Only Supabase's sign-in part** (`@supabase/auth-js`), not the whole Supabase client: the
 *   app reads and writes everything else through our typed API, so its code stays small.
 * - **The session is kept on the phone, encrypted** (storage.ts), and refreshed on its own while
 *   the app is in front; refreshing stops in the background and starts again on return, as
 *   Supabase advises for apps.
 * - **PKCE for Google**: the browser's code is useless without the verifier only this app holds.
 * - **The token goes to our API with personal calls only** (lib/api.ts), so public reads stay
 *   cacheable at the edge.
 */

let client: Promise<GoTrueClient> | undefined;

/** The sign-in client, made once its settings arrive; a failure is tried again next time. */
export function authClient(): Promise<GoTrueClient> {
  client ??= api.auth
    .settings()
    .then(({ supabaseUrl, publishableKey }) => {
      const auth = new GoTrueClient({
        url: `${supabaseUrl}/auth/v1`,
        // As Supabase's own client sends them: the publishable key, until a session's token
        // takes its place on the calls that need one.
        headers: { Authorization: `Bearer ${publishableKey}`, apikey: publishableKey },
        // Supabase's own name for the project's session, so the session belongs to the project.
        storageKey: `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`,
        storage: sessionStorage,
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      });
      refreshWhileInFront(auth);
      // Personal calls to our API carry the session's token (refreshed first if it has run out).
      sendTokensFrom(async () => (await auth.getSession()).data.session?.access_token ?? null);
      return auth;
    })
    .catch((error: unknown) => {
      // The settings didn't come, or didn't make a client: try again next time.
      client = undefined;
      throw error;
    });
  return client;
}

function refreshWhileInFront(auth: GoTrueClient) {
  const follow = (state: string) => {
    if (state === 'active') void auth.startAutoRefresh();
    else void auth.stopAutoRefresh();
  };
  follow(AppState.currentState ?? 'active');
  AppState.addEventListener('change', follow);
}
