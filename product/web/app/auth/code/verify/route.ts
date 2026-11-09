import { type NextRequest, NextResponse } from 'next/server';
import { cleanCode, PENDING_COOKIE, readPendingCookie } from '@/lib/email-code.ts';
import { signInTestEnabled } from '@/lib/env.ts';
import { sameSiteUrl } from '@/lib/safe-next.ts';
import { createRouteClient, sameOrigin } from '@/lib/supabase/route.ts';

/**
 * What to tell the visitor when Supabase doesn't accept the code: too many tries; a fault on
 * the way (no answer, or Supabase's own error), which is worth trying again; or a code that is
 * wrong or has run out.
 */
function verifyError(status: number | undefined): string {
  if (status === 429) return 'too-many';
  if (!status || status >= 500) return 'verify-failed';
  return 'code-wrong';
}

/**
 * Step 2 of signing in with an email code (lib/email-code.ts): Supabase Auth checks the code
 * for the address in the cookie, and the session it issues is stored in cookies, exactly as
 * after Google. A wrong or expired code leaves the visitor on the code step to try again (or
 * ask for a new one); Supabase limits how many codes can be tried. Not under /auth/email/:
 * it sends no email, so it has the sign-in routes' rate limit (infra/vercel/firewall.json).
 */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const origin = request.nextUrl.origin;
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/sign-in-test?error=${error}`, origin), 303);

  const pending = readPendingCookie(request.cookies.get(PENDING_COOKIE)?.value);
  if (!pending) return back('code-expired');
  const form = await request.formData();
  const code = cleanCode(form.get('code'));
  if (!code) return back('code-format');

  const client = createRouteClient(request);
  if (!client) return back('not-configured');
  const { error } = await client.supabase.auth.verifyOtp({
    email: pending.email,
    token: code,
    type: 'email',
  });
  if (error) return back(verifyError(error.status));

  const response = client.respond(NextResponse.redirect(sameSiteUrl(pending.next, origin), 303));
  response.cookies.delete(PENDING_COOKIE);
  return response;
}
