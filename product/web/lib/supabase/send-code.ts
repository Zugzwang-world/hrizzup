import { createClient } from '@supabase/supabase-js';

export type SendResult = 'sent' | 'too-many' | 'failed';

/**
 * Asks Supabase Auth to email a sign-in code to `email`, creating the account if it is new.
 * Called only by our server, after it has checked the visitor's bot-check answer itself
 * (lib/turnstile.ts), and with the server key (`SUPABASE_SECRET_KEY`), which Supabase Auth
 * lets past its own bot check: previews use Cloudflare's test keys, whose answers Supabase's
 * copy of the real secret would refuse. Supabase's direct address still demands a real
 * bot-check answer from anyone else.
 *
 * Supabase Auth's email limits still apply (infra/supabase/auth/settings.json): one email a
 * minute to the same address, and 30 an hour for the whole project; past either, it answers
 * 429 and nothing is sent. The email carries only the code (no link), through Resend.
 */
export async function sendSignInCode(
  url: string,
  secretKey: string,
  email: string,
): Promise<SendResult> {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (!error) return 'sent';
  return error.status === 429 ? 'too-many' : 'failed';
}
