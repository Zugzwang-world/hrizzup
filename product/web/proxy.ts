import { type NextRequest, NextResponse } from 'next/server';
import { consoleAdmin } from './lib/api/console.ts';
import { createRouteClient } from './lib/supabase/route.ts';

/**
 * An address the site can never have a page for: App Router never routes a folder whose name
 * starts with `_` (a private folder), so this always ends at the site's own "not found" page.
 */
export const NO_SUCH_PAGE = '/_no-such-page';

/** Whether an address is one of the market console's pages (`/console` and everything below). */
export function isConsolePage(pathname: string): boolean {
  return pathname === '/console' || pathname.startsWith('/console/');
}

/**
 * Runs on the pages that read the session (see `config`), so the holding page pays nothing:
 *
 * - Keeps a signed-in visitor's session fresh. Server components can't write cookies, so an
 *   expired access token is refreshed here, before the page renders.
 * - Shows the market console only to admins (PLAN.md step 1.7c). Anyone else, signed in or not,
 *   and everyone on production until launch, is handed `NO_SUCH_PAGE` instead (a rewrite: the
 *   address stays as typed), so they get the site's "not found" page exactly as for any address
 *   it doesn't have: the same answer, rendered once when the site was built, with no script of
 *   the console's. A page that called `notFound()` itself would answer with an empty error page
 *   that the phone then builds with JavaScript, which is both slower (the Speed check measured it)
 *   and different from an unknown address. The pages and forms still check again themselves.
 */
export async function proxy(request: NextRequest) {
  const consolePage = isConsolePage(request.nextUrl.pathname);
  const client = createRouteClient(request);
  if (!client) return consolePage ? noSuchPage(request) : NextResponse.next();
  // Nothing may run between creating the client and getClaims(), or sessions can be lost.
  await client.supabase.auth.getClaims();
  // A refreshed session's cookies go out on either answer: its old refresh token is used up.
  if (consolePage && !(await consoleAdmin(request.headers))) {
    return client.respond(noSuchPage(request));
  }
  return client.respond(NextResponse.next({ request }));
}

function noSuchPage(request: NextRequest): NextResponse {
  return NextResponse.rewrite(new URL(NO_SUCH_PAGE, request.url));
}

export const config = {
  matcher: ['/sign-in-test', '/console', '/console/:path*', '/sandbox', '/sandbox/:path*'],
};
