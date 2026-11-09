/**
 * Whether a request is a write from another site riding on the website's session cookie (cross-site
 * request forgery), refused before anything runs. A browser says where a request comes from
 * (`Sec-Fetch-Site`, and `Origin` on every write); a write from another site, or from another of our
 * own subdomains, is refused unless it carries its own token (`Authorization`), which no other site's
 * page can attach without our say-so (the API answers no cross-origin requests). Reads change
 * nothing, and clients that aren't browsers (the app, which sends its token) send neither header.
 */
export function crossSiteWrite(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  if (request.headers.has('authorization')) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  return origin !== null && origin !== new URL(request.url).origin;
}
