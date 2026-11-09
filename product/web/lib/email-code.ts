import { safeNext } from './safe-next.ts';

/**
 * Signing in with a code sent by email (PLAN.md step 1.6a; blueprint section 9).
 *
 * 1. The visitor gives their email address and passes the bot check (Turnstile); our server
 *    checks the bot check's answer and asks Supabase Auth to email a code
 *    (app/auth/email/code/route.ts).
 * 2. A short-lived cookie remembers which address the code went to, so the page can ask for
 *    the code (`PENDING_COOKIE`).
 * 3. The visitor types the code; our server has Supabase check it and sets the session's
 *    cookies (app/auth/code/verify/route.ts). Only asking for a code lives under
 *    /auth/email/, which the firewall keeps for routes that send email (5 requests a minute
 *    per visitor); checking a code needs the sign-in routes' limit (20 a minute).
 *
 * There is no password anywhere: Supabase Auth's settings (infra/supabase/auth/settings.json)
 * make every email carry only a code, and the access-token hook refuses any session made with
 * a password (infra/supabase/migrations/…_refuse_password_sessions.sql).
 */

/** Digits in a code: Supabase Auth's `mailer_otp_length` (a unit test keeps them equal). */
export const CODE_LENGTH = 8;

/** How long a code works, in minutes: Supabase Auth's `mailer_otp_exp` (tested equal too). */
export const CODE_MINUTES = 10;

/** The cookie naming the address a code was just sent to, and where to go after signing in. */
export const PENDING_COOKIE = 'hz-email-code';

export type PendingCode = { email: string; next: string };

/** The cookie's settings: readable only by our server, gone when the code stops working. */
export function pendingCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: CODE_MINUTES * 60,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An email address as typed, tidied the way Supabase Auth stores it (trimmed, lower case), or
 * null when it can't be one. Supabase Auth checks it again on its side.
 */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

/**
 * A code as typed, with any spaces or dashes taken out (people copy "1234 5678"), or null
 * when it isn't exactly `CODE_LENGTH` digits.
 */
export function cleanCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const code = value.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) ? code : null;
}

/** The cookie's value for a code just sent. */
export function pendingCookieValue(pending: PendingCode): string {
  return JSON.stringify({ email: pending.email, next: safeNext(pending.next) });
}

/**
 * The address a code was sent to, from the cookie, or null when there's none (or it isn't one
 * of ours). The visitor can change their own cookie, but that gains nothing: a code only works
 * for the address it was sent to.
 */
export function readPendingCookie(value: string | undefined): PendingCode | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { email?: unknown; next?: unknown };
    const email = cleanEmail(parsed.email);
    if (!email) return null;
    return { email, next: safeNext(parsed.next) };
  } catch {
    return null;
  }
}
