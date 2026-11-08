/**
 * Getting past Vercel's login on a protected deployment (a preview, or staging) without the
 * secret ever leaving our own address.
 *
 * The protection bypass for automation (`VERCEL_AUTOMATION_BYPASS_SECRET`) goes once, in one
 * request to the deployment itself, asking Vercel for its bypass cookie (`_vercel_jwt`, set for
 * that address only). Browsers then carry only the cookie, which they send to our address and
 * nowhere else, so the secret can't reach the other sites a page loads (such as X's embeds), as
 * it would if every request carried the bypass header.
 */

export const BYPASS_COOKIE = '_vercel_jwt';

/** Vercel's bypass cookie's value for one protected deployment. Never printed. */
export async function bypassCookieValue(base: string, secret: string): Promise<string> {
  const response = await fetch(new URL('/', base), {
    headers: { 'x-vercel-protection-bypass': secret, 'x-vercel-set-bypass-cookie': 'true' },
    redirect: 'manual',
  });
  for (const header of response.headers.getSetCookie()) {
    const [pair = ''] = header.split(';');
    const [name, ...value] = pair.split('=');
    if (name?.trim() === BYPASS_COOKIE) return value.join('=').trim();
  }
  throw new Error(`Vercel gave no bypass cookie for ${base} (it answered ${response.status})`);
}

export type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
};

/** The cookie as a browser's saved state holds it, for the deployment at `base`. */
export function asBrowserCookie(base: string, name: string, value: string): BrowserCookie {
  const { hostname, protocol } = new URL(base);
  return {
    name,
    value,
    domain: hostname,
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: name === BYPASS_COOKIE,
    secure: protocol === 'https:',
    sameSite: 'Lax',
  };
}
