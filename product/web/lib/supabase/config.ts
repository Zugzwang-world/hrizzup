/** Supabase's address and publishable key, from Doppler, or null where sign-in isn't set up. */
export function supabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { url: string; publishableKey: string } | null {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** Cookies are only marked Secure off this Mac, where the site runs on plain http. */
export const cookieOptions = {
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
} as const;
