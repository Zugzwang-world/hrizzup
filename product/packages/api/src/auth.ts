import { z } from 'zod';

/**
 * The app's sign-in calls (PLAN.md step 1.6b; blueprint section 9). The app signs in with Supabase
 * Auth, on the same accounts as the website:
 *
 * - **Its settings come from here,** at run time (`auth.settings`): Supabase's address and its
 *   publishable key, which is public by design and safe in an app. Nothing is built into the app,
 *   so no key lives in the repository or the app's build, and each environment's come from Doppler,
 *   as the website's do.
 * - **Email codes go through our server** (`auth.emailCode`): the app shows the bot check in a small
 *   web view, on our own page (`BOT_CHECK_PATH` in `@hrizzup/core`), and sends its one-time answer
 *   here with the address; our server checks the answer with Cloudflare exactly as the website does,
 *   then has Supabase Auth email a code. The app checks the code with Supabase Auth itself, which
 *   gives it its own session; checking a code sends no email, so it needs no bot check.
 * - **Google** goes through the phone's browser, straight to Supabase, with these same settings.
 */

/** Supabase Auth's public settings, which the app signs in with. */
export const authSettings = z.object({
  /** The Supabase project's address, such as `https://<project>.supabase.co`. */
  supabaseUrl: z.url({ protocol: /^https$/ }),
  /** Supabase's publishable key: public by design, safe in an app or a browser. */
  publishableKey: z.string().min(1).max(200),
});

/** Asking for an email code: the address, and the bot check's one-time answer. */
export const emailCodeInput = z.strictObject({
  /** As typed; our server tidies it the way Supabase Auth keeps it (trimmed, lower case). */
  email: z.string().max(254),
  /** The bot check's one-time answer (Cloudflare Turnstile's token), at most 2,048 characters. */
  botCheck: z.string().min(1).max(2048),
});

/** A code is on its way. */
export const emailCodeSent = z.object({
  /** The address the code went to, as Supabase Auth keeps it. */
  email: z.email(),
  /** How many digits the code has. */
  codeLength: z.number().int().positive(),
  /** How many minutes it works for. */
  minutes: z.number().int().positive(),
});

/** What the app's sign-in calls can refuse with. */
export const authErrors = {
  /** Sign-in isn't set up in this environment (production, until launch). */
  NOT_SET_UP: { status: 503, message: "Sign-in isn't set up here" },
  INVALID_EMAIL: { status: 400, message: 'Not a valid email address' },
  BOT_CHECK_FAILED: { status: 403, message: "The bot check didn't pass" },
  /** Supabase Auth's limits: one email a minute to an address, and its hourly limit. */
  TOO_MANY_REQUESTS: { status: 429, message: 'Too many codes were asked for: wait a minute' },
  SEND_FAILED: { status: 502, message: "The code couldn't be sent" },
} as const;

export type AuthSettings = z.infer<typeof authSettings>;
export type EmailCodeInput = z.infer<typeof emailCodeInput>;
export type EmailCodeSent = z.infer<typeof emailCodeSent>;
