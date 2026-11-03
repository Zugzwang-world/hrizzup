const FALLBACK = '/sign-in-test';
const BASE = 'https://hrizzup.invalid';

/**
 * Where to send someone after signing in. Only a path on this same site is accepted, so the
 * sign-in can't be used to bounce a visitor to another site (an "open redirect"). Anything
 * else, including `//other.site` and `/\other.site`, falls back to the sign-in test page.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return FALLBACK;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return FALLBACK;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK;
  }
}
