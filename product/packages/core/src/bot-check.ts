/**
 * The bot check the app shows in a small web view (PLAN.md step 1.6b; blueprint section 9).
 *
 * Cloudflare's widget (Turnstile) runs only in a browser, so the app opens a page of the
 * website's (`BOT_CHECK_PATH`) in a web view, as Cloudflare advises for apps. The page tells the
 * app what happens through the web view's message channel, in the messages below; the app sends
 * the widget's one-time answer to our server with the address (the typed API's
 * `auth.emailCode`), and our server checks it with Cloudflare exactly as the website does. The
 * page and the app read these messages from here, so they can't drift apart.
 */

/** The page's address on the website (the app's typed API's own host). */
export const BOT_CHECK_PATH = '/auth/app/bot-check';

export type BotCheckMessage =
  /** The widget's one-time answer: it works once, within 5 minutes. */
  | { kind: 'answer'; answer: string }
  /** The answer ran out unused; the widget makes a new one by itself. */
  | { kind: 'expired' }
  /** The widget couldn't run (no connection, or Cloudflare refused this device). */
  | { kind: 'error' }
  /** How tall the page's content is, in CSS pixels, so the web view can fit it. */
  | { kind: 'height'; height: number };

const TYPE = 'hrizzup-bot-check';

/** A message as the page sends it (the web view's channel carries strings). */
export function botCheckMessage(message: BotCheckMessage): string {
  return JSON.stringify({ type: TYPE, ...message });
}

/** The message in what the web view received, or null when it isn't one of ours. Never throws. */
export function readBotCheckMessage(data: unknown): BotCheckMessage | null {
  if (typeof data !== 'string' || data.length > 4096) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as { type?: unknown; kind?: unknown; answer?: unknown; height?: unknown };
  if (message.type !== TYPE) return null;
  switch (message.kind) {
    case 'answer':
      return typeof message.answer === 'string' &&
        message.answer.length > 0 &&
        message.answer.length <= 2048
        ? { kind: 'answer', answer: message.answer }
        : null;
    case 'expired':
      return { kind: 'expired' };
    case 'error':
      return { kind: 'error' };
    case 'height':
      return typeof message.height === 'number' &&
        Number.isFinite(message.height) &&
        message.height > 0 &&
        message.height <= 1000
        ? { kind: 'height', height: Math.ceil(message.height) }
        : null;
    default:
      return null;
  }
}
