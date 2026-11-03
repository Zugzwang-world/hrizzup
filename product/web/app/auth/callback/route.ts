import { type NextRequest, NextResponse } from 'next/server';
import { signInTestEnabled } from '@/lib/env.ts';
import { sameSiteUrl } from '@/lib/safe-next.ts';
import { createRouteClient } from '@/lib/supabase/route.ts';

/**
 * Where the visitor comes back after Google (from Supabase, or on a preview from staging's
 * relay). The one-time code is exchanged for a session (stored in cookies), then the
 * visitor returns to the page they started from, which is always on this same site.
 * Errors never echo Google's or Supabase's wording back onto the page.
 */
export async function GET(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  const params = request.nextUrl.searchParams;
  const back = (error?: string) => {
    const url = sameSiteUrl(params.get('next'), request.nextUrl.origin);
    if (error) url.searchParams.set('error', error);
    return url;
  };

  const client = createRouteClient(request);
  if (!client) return NextResponse.redirect(back('not-configured'), 303);
  const code = params.get('code');
  if (!code) return NextResponse.redirect(back(params.get('error') ? 'refused' : 'no-code'), 303);

  const { error } = await client.supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(back('exchange'), 303);
  return client.respond(NextResponse.redirect(back(), 303));
}
