import { type NextRequest, NextResponse } from 'next/server';
import { isPreviewOrigin, relayReturnAddress } from '@/lib/auth-relay.ts';
import { currentEnvironment, signInTestEnabled } from '@/lib/env.ts';
import { safeNext } from '@/lib/safe-next.ts';
import { createRouteClient, sameOrigin } from '@/lib/supabase/route.ts';

/**
 * Starts "Sign in with Google" through Supabase's redirect flow (PKCE). Supabase stores a
 * one-time code verifier in a cookie on this response, then the visitor goes to Google,
 * back to Supabase, and finally to /auth/callback on this same site. On a preview, the
 * way back goes through staging's signed relay (lib/auth-relay.ts), because Supabase only
 * returns visitors to our own addresses.
 */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const origin = request.nextUrl.origin;
  const failed = (error: string) =>
    NextResponse.redirect(new URL(`/sign-in-test?error=${error}`, origin), 303);
  const client = createRouteClient(request);
  if (!client) return failed('not-configured');

  const form = await request.formData();
  const next = safeNext(form.get('next'));
  let redirectTo: string;
  if (currentEnvironment() === 'preview') {
    const secret = process.env.AUTH_RELAY_SECRET;
    if (!secret || !isPreviewOrigin(origin)) return failed('not-configured');
    redirectTo = relayReturnAddress(secret, origin, next);
  } else {
    const callback = new URL('/auth/callback', origin);
    callback.searchParams.set('next', next);
    redirectTo = callback.toString();
  }

  const { data, error } = await client.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) return failed('start');
  return client.respond(NextResponse.redirect(data.url, 303));
}
