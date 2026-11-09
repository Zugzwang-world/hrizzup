import type { Environment } from '@hrizzup/core';

/**
 * The bot check (Cloudflare Turnstile; blueprint section 9), checked on our server before any
 * email is sent. The widget in the page hands the browser a one-time answer; the form posts it
 * as `cf-turnstile-response`, and this asks Cloudflare whether it is genuine, with this
 * environment's own secret (`TURNSTILE_SECRET_KEY`).
 *
 * Previews use Cloudflare's published test keys (their addresses change with every pull
 * request), whose answers Cloudflare marks as made with a testing key. Those are accepted only
 * on previews and this Mac: staging and production must have the real widget, so a testing
 * key's answer there is refused. For a real answer, the page it was solved on and the action
 * must be ours too, as Cloudflare advises.
 */

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The widget's action for asking for an email code; Cloudflare reports it back. */
export const EMAIL_CODE_ACTION = 'email-code';

/** The form field the widget fills with its answer. */
export const RESPONSE_FIELD = 'cf-turnstile-response';

type Siteverify = {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  metadata?: { result_with_testing_key?: unknown };
};

export type BotCheck = {
  secret: string;
  /** What the form posted as the widget's answer. */
  answer: unknown;
  /** The page's own host name, where a real answer must have been solved. */
  hostname: string;
  action: string;
  environment: Environment;
  /** The visitor's address, which Cloudflare uses as one more signal. */
  ip?: string | undefined;
  fetcher?: typeof fetch;
};

/** True only when Cloudflare confirms the answer, under the rules above. Never throws. */
export async function passesBotCheck(check: BotCheck): Promise<boolean> {
  const { answer } = check;
  if (typeof answer !== 'string' || answer.length === 0 || answer.length > 2048) return false;
  const body = new URLSearchParams({ secret: check.secret, response: answer });
  if (check.ip) body.set('remoteip', check.ip);
  try {
    const response = await (check.fetcher ?? fetch)(SITEVERIFY, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as Siteverify;
    if (result.success !== true) return false;
    if (result.metadata?.result_with_testing_key === true) {
      return check.environment === 'preview' || check.environment === 'development';
    }
    return result.hostname === check.hostname && result.action === check.action;
  } catch {
    return false;
  }
}
