const FALLBACK = '/sign-in-test';
const BASE = 'https://hrizzup.invalid';

/**
 * Where to send someone after signing in. Only a path on this same site is accepted, so the
 * sign-in can't be used to bounce a visitor to another site (an "open redirect"). The value
 * is checked both as given and after the browser's own clean-up (`/..//x` becomes `//x`,
 * which a browser reads as another site), and anything doubtful falls back to the sign-in
 * test page.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return FALLBACK;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return FALLBACK;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return FALLBACK;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return FALLBACK;
    return path;
  } catch {
    return FALLBACK;
  }
}

/** The full address of a safe `next` path on this site; never another site's address. */
export function sameSiteUrl(next: unknown, origin: string): URL {
  const url = new URL(safeNext(next), origin);
  return url.origin === origin ? url : new URL(FALLBACK, origin);
}
