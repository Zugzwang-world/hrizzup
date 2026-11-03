import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeNext } from './safe-next.ts';

/**
 * Google sign-in on previews, without letting Supabase send sign-in codes to any
 * `vercel.app` address (anyone can create a `vercel.app` site, so a pattern for them can
 * be matched by a stranger's site too).
 *
 * Supabase only ever returns visitors to staging, this Mac or production. A preview that
 * starts a sign-in asks Supabase to return the visitor to staging's relay
 * (`/auth/relay`), with a note saying which preview to forward to, signed with
 * AUTH_RELAY_SECRET (Doppler `stg`, which previews inherit). The relay forwards the
 * one-time code only to a preview address that is correctly signed and recent. The code is
 * then exchanged on the preview itself, which alone holds the matching code verifier
 * (PKCE), so a forwarded code is useless anywhere else.
 */
export const STAGING_ORIGIN = 'https://staging.hrizzup.com';

/** Our previews' addresses: project `hrizzup`, team `hrizzup` (a second check, after the signature). */
const PREVIEW_HOST = /^hrizzup-[a-z0-9-]+-hrizzup\.vercel\.app$/;
const LIFETIME_S = 15 * 60;

function signature(secret: string, to: string, next: string, exp: number): string {
  return createHmac('sha256', secret)
    .update(`relay-v1\n${to}\n${next}\n${exp}`)
    .digest('base64url');
}

export function isPreviewOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin && PREVIEW_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** The address Supabase should return a preview's visitor to: staging's relay, signed. */
export function relayReturnAddress(
  secret: string,
  previewOrigin: string,
  next: string,
  now = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + LIFETIME_S;
  const safe = safeNext(next);
  const url = new URL('/auth/relay', STAGING_ORIGIN);
  url.searchParams.set('to', previewOrigin);
  url.searchParams.set('next', safe);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', signature(secret, previewOrigin, safe, exp));
  return url.toString();
}

/**
 * Checks a request to the relay. Returns the preview's own callback address, carrying the
 * one-time code (or Google's refusal), or null if anything is wrong: a missing, forged or
 * expired signature, or an address that isn't one of our previews.
 */
export function relayTarget(secret: string, params: URLSearchParams, now = Date.now()): URL | null {
  const to = params.get('to');
  const next = params.get('next');
  const sig = params.get('sig');
  const exp = Number(params.get('exp'));
  if (!to || !next || !sig || !Number.isInteger(exp)) return null;
  const nowS = now / 1000;
  if (exp < nowS || exp > nowS + LIFETIME_S + 60) return null;
  if (!isPreviewOrigin(to)) return null;
  const expected = Buffer.from(signature(secret, to, next, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const target = new URL('/auth/callback', to);
  target.searchParams.set('next', safeNext(next));
  for (const key of ['code', 'error']) {
    const value = params.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target;
}
