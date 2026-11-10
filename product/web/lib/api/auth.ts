import type { AuthSettings, EmailCodeInput, EmailCodeSent } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import { ipAddress } from '@vercel/functions';
import { CODE_LENGTH, CODE_MINUTES, cleanEmail } from '@/lib/email-code.ts';
import { currentEnvironment, signInTestEnabled } from '@/lib/env.ts';
import { supabaseConfig } from '@/lib/supabase/config.ts';
import { sendSignInCode } from '@/lib/supabase/send-code.ts';
import { EMAIL_CODE_ACTION, passesBotCheck } from '@/lib/turnstile.ts';
import type { ApiContext } from './context.ts';

/**
 * The app's sign-in calls in the website's API (PLAN.md step 1.6b; the contract's auth.ts):
 * Supabase Auth's public settings, and asking for an email code behind the bot check, checked
 * here exactly as the website's own form is (app/auth/email/code/route.ts). Like every sign-in
 * route, both exist everywhere but production until launch, where they answer "not set up" (503).
 */

type Env = Readonly<Record<string, string | undefined>>;

function notSetUp() {
  return new ORPCError('NOT_SET_UP', { status: 503, message: "Sign-in isn't set up here" });
}

/** Supabase's address and publishable key: public by design, so the app can be given them. */
export function appAuthSettings(env: Env = process.env): AuthSettings {
  const config = signInTestEnabled(env) ? supabaseConfig(env) : null;
  if (!config) throw notSetUp();
  return { supabaseUrl: config.url, publishableKey: config.publishableKey };
}

/**
 * Emails a sign-in code: the address must be one, the bot check's answer must pass Cloudflare's
 * check for this host and the email-code action (testing keys' answers only on previews and
 * this Mac), and then Supabase Auth sends the code, with its own limits (one email a minute to an
 * address; its hourly limit). The answer works once, so a refused send needs a new one.
 */
export async function appEmailCode(
  context: Pick<ApiContext, 'headers' | 'url'>,
  input: EmailCodeInput,
  env: Env = process.env,
): Promise<EmailCodeSent> {
  const config = signInTestEnabled(env) ? supabaseConfig(env) : null;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const botSecret = env.TURNSTILE_SECRET_KEY;
  if (!config || !secretKey || !botSecret || !context.url) throw notSetUp();

  const email = cleanEmail(input.email);
  if (!email) {
    throw new ORPCError('INVALID_EMAIL', { status: 400, message: 'Not a valid email address' });
  }
  const human = await passesBotCheck({
    secret: botSecret,
    answer: input.botCheck,
    hostname: new URL(context.url).hostname,
    action: EMAIL_CODE_ACTION,
    environment: currentEnvironment(env),
    ip: ipAddress(context.headers),
  });
  if (!human) {
    throw new ORPCError('BOT_CHECK_FAILED', { status: 403, message: "The bot check didn't pass" });
  }

  const sent = await sendSignInCode(config.url, secretKey, email);
  if (sent === 'too-many') {
    throw new ORPCError('TOO_MANY_REQUESTS', {
      status: 429,
      message: 'Too many codes were asked for: wait a minute',
    });
  }
  if (sent !== 'sent') {
    throw new ORPCError('SEND_FAILED', { status: 502, message: "The code couldn't be sent" });
  }
  return { email, codeLength: CODE_LENGTH, minutes: CODE_MINUTES };
}
