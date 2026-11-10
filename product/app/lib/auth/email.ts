import type { EmailCodeSent } from '@hrizzup/api/client';
import { ORPCError } from '@orpc/client';
import { api } from '../api.ts';
import { authClient } from './client.ts';
import { type SendOutcome, sendOutcome, type VerifyOutcome, verifyOutcome } from './email-code.ts';

/**
 * Signing in with a code sent by email, in the app (PLAN.md step 1.6b; blueprint section 9).
 *
 * 1. The person types their address while the bot check runs in a small web view
 *    (components/bot-check.tsx), which hands the app its one-time answer.
 * 2. The app asks our server for the code through the typed API (`auth.emailCode`), with the
 *    address and the answer; our server checks the answer with Cloudflare, exactly as for the
 *    website's form, and then has Supabase Auth email the code.
 * 3. The person types the code, and the app checks it with Supabase Auth itself, which gives the
 *    app its own session, kept on the phone (storage.ts). Checking sends no email, so it needs no
 *    bot check; Supabase limits the tries.
 *
 * No password anywhere: the email carries only the code.
 */

export type Sent =
  | { outcome: 'sent'; sent: EmailCodeSent }
  | { outcome: Exclude<SendOutcome, 'sent'> };

/** Asks our server to email a code to `email`, with the bot check's answer. */
export async function requestCode(email: string, botCheck: string): Promise<Sent> {
  try {
    return { outcome: 'sent', sent: await api.auth.emailCode({ email, botCheck }) };
  } catch (error) {
    const outcome = sendOutcome(error instanceof ORPCError ? String(error.code) : undefined);
    return { outcome: outcome === 'sent' ? 'failed' : outcome };
  }
}

/** Checks a code for `email` with Supabase Auth; signed in, the session is kept on the phone. */
export async function checkCode(email: string, code: string): Promise<VerifyOutcome> {
  try {
    const auth = await authClient();
    const { error } = await auth.verifyOtp({ email, token: code, type: 'email' });
    return verifyOutcome(error);
  } catch {
    return 'failed';
  }
}
