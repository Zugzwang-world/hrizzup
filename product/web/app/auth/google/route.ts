import { type NextRequest, NextResponse } from 'next/server';
import { signInTestEnabled } from '@/lib/env.ts';
import { safeNext } from '@/lib/safe-next.ts';
import { createRouteClient, sameOrigin } from '@/lib/supabase/route.ts';

/**
 * Starts "Sign in with Google" through Supabase's redirect flow (PKCE). Supabase stores a
 * one-time code verifier in a cookie on this response, then the visitor goes to Google,
 * back to Supabase, and finally to /auth/callback on this same site.
 */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const client = createRouteClient(request);
  if (!client)
    return NextResponse.redirect(new URL('/sign-in-test?error=not-configured', request.url), 303);

  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const callback = new URL('/auth/callback', request.nextUrl.origin);
  callback.searchParams.set('next', next);

  const { data, error } = await client.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    return NextResponse.redirect(new URL('/sign-in-test?error=start', request.url), 303);
  }
  return client.respond(NextResponse.redirect(data.url, 303));
}
