/**
 * Signing in with a code sent by email, in the app (PLAN.md step 1.6b), the parts that need no
 * phone: tidying what's typed, and the words for each way it can end, the website's own (its
 * sign-in test page). The steps themselves are in email.ts.
 */

/** Digits in a code (Supabase Auth's `mailer_otp_length`), until the server says otherwise. */
export const CODE_LENGTH = 8;

/** Minutes a code works (Supabase Auth's `mailer_otp_exp`), until the server says otherwise. */
export const CODE_MINUTES = 10;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An address as typed, tidied (trimmed, lower case), or null when it can't be one. */
export function cleanEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

/** A code as typed, without the spaces or dashes people copy with it, or null if it isn't one. */
export function cleanCode(value: string, length = CODE_LENGTH): string | null {
  if (value.length > 64) return null;
  const code = value.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${length}}$`).test(code) ? code : null;
}

/** How asking for a code ended, from the typed API's answer (its error code), or the network. */
export type SendOutcome =
  | 'sent'
  | 'invalid-email'
  | 'bot-check'
  | 'too-many'
  | 'not-set-up'
  | 'unreachable'
  | 'failed';

export function sendOutcome(errorCode: string | undefined): SendOutcome {
  switch (errorCode) {
    case 'INVALID_EMAIL':
      return 'invalid-email';
    case 'BOT_CHECK_FAILED':
      return 'bot-check';
    case 'TOO_MANY_REQUESTS':
      return 'too-many';
    case 'NOT_SET_UP':
      return 'not-set-up';
    case undefined:
      return 'unreachable';
    default:
      return 'failed';
  }
}

export const SEND_MESSAGES: Record<Exclude<SendOutcome, 'sent'>, string> = {
  'invalid-email': 'Enter a valid email address.',
  'bot-check': "The bot check didn't pass. Try again.",
  'too-many': 'Too many codes were asked for. Wait a minute, then try again.',
  'not-set-up': "Sign-in isn't set up in this environment.",
  unreachable: "Hrizzup's servers can't be reached right now. Try again.",
  failed: "The code couldn't be sent. Try again.",
};

/** How checking a code ended, from Supabase Auth's answer. */
export type VerifyOutcome = 'signed-in' | 'wrong' | 'too-many' | 'failed';

/**
 * Supabase answers a wrong or expired code with a 4xx (403, "otp_expired"); too many tries with
 * 429; anything else (no answer, or its own fault) is worth trying again.
 */
export function verifyOutcome(error: { status?: number } | null): VerifyOutcome {
  if (!error) return 'signed-in';
  const status = error.status ?? 0;
  if (status === 429) return 'too-many';
  if (status >= 400 && status < 500) return 'wrong';
  return 'failed';
}

export const VERIFY_MESSAGES: Record<Exclude<VerifyOutcome, 'signed-in'>, string> = {
  wrong: "That code didn't work. Check it and try again, or get a new code.",
  'too-many': 'Too many tries. Wait a minute, then try again.',
  failed: "The code couldn't be checked just now. Try again.",
};

export function codeFormatMessage(length = CODE_LENGTH): string {
  return `Enter the ${length}-digit code from the email.`;
}
