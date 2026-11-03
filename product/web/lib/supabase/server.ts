import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cookieOptions, supabaseConfig } from './config.ts';

/**
 * A Supabase client for server components, bound to this request's cookies. A new one per
 * request: with Fluid compute, a shared client could mix up two visitors' sessions.
 * Returns null where sign-in isn't configured (production, until launch).
 */
export async function createClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Server components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
