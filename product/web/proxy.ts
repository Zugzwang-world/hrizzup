import { type NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from './lib/supabase/route.ts';

/**
 * Keeps a signed-in visitor's session fresh on the pages that read it. Server components
 * can't write cookies, so an expired access token is refreshed here, before the page
 * renders. It runs only on those pages (see `config`), so the holding page pays nothing.
 */
export async function proxy(request: NextRequest) {
  const client = createRouteClient(request);
  if (!client) return NextResponse.next();
  // Nothing may run between creating the client and getClaims(), or sessions can be lost.
  await client.supabase.auth.getClaims();
  return client.respond(NextResponse.next({ request }));
}

export const config = {
  matcher: ['/sign-in-test'],
};
