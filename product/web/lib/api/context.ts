import { combineChunks, parseCookieHeader, stringFromBase64URL } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { supabaseConfig } from '@/lib/supabase/config.ts';

/**
 * What every call of the typed API is given: the request's headers (cookie, token); over HTTP, its
 * full address, whose host the bot check's answer must match (lib/api/auth.ts); and, on the market
 * console's calls over HTTP, the admin the API's route has already checked (lib/api/console.ts),
 * so the database is asked once.
 */
export type ApiContext = {
  headers: Headers;
  url?: string;
  consoleAdmin?: { account: string; pool: Pick<Pool, 'connect'> } | null;
};

export type SignedIn = {
  id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
  testAccount: boolean;
};

const BASE64_PREFIX = 'base64-';

/** The name Supabase gives this project's session cookie (supabase-js's default storage key). */
export function sessionCookieName(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/**
 * The access token in the website's session cookie, read exactly as Supabase stores it (split
 * into chunks, `base64-` and JSON), and never refreshed here. Refreshing a session uses up its
 * refresh token, and the new one must reach the browser in a cookie, which only the proxy
 * writes (proxy.ts, on the pages that read the session); a read that refreshed and threw the
 * new cookie away could later sign the person out. So an expired token is simply refused.
 */
export async function accessTokenFromCookies(
  cookieHeader: string | null,
  supabaseUrl: string,
): Promise<string | null> {
  const cookies = new Map(
    parseCookieHeader(cookieHeader ?? '').map(({ name, value }) => [name, value ?? '']),
  );
  const raw = await combineChunks(sessionCookieName(supabaseUrl), (name) => cookies.get(name));
  if (!raw) return null;
  try {
    const json = raw.startsWith(BASE64_PREFIX)
      ? stringFromBase64URL(raw.slice(BASE64_PREFIX.length))
      : raw;
    const session = JSON.parse(json) as { access_token?: unknown };
    return typeof session.access_token === 'string' ? session.access_token : null;
  } catch {
    return null;
  }
}

let verifierClient: SupabaseClient | undefined;

/** A client that holds no session, only to check tokens (its key list is cached in memory). */
function verifier(url: string, publishableKey: string): SupabaseClient {
  verifierClient ??= createSupabaseClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifierClient;
}

/**
 * Who is signed in, from the request: the app sends its session's token as `Authorization:
 * Bearer …`; the website sends its session cookie. Either way the token's signature and expiry
 * are checked locally against the project's public key (`getClaims`), with no trip to Supabase
 * once the key is known, and nothing is ever refreshed or written. Null when nobody is, or
 * sign-in isn't set up here.
 */
export async function signedIn(headers: Headers): Promise<SignedIn | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const bearer = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '')?.[1];
  const token = bearer ?? (await accessTokenFromCookies(headers.get('cookie'), config.url));
  if (!token) return null;
  const { data, error } = await verifier(config.url, config.publishableKey).auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const app = (claims.app_metadata ?? {}) as { provider?: unknown; test_account?: unknown };
  const user = (claims.user_metadata ?? {}) as { full_name?: unknown };
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: typeof user.full_name === 'string' ? user.full_name : null,
    provider: typeof app.provider === 'string' ? app.provider : null,
    testAccount: app.test_account === true,
  };
}
