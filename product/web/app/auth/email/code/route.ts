import { ipAddress } from '@vercel/functions';
import { type NextRequest, NextResponse } from 'next/server';
import {
  cleanEmail,
  PENDING_COOKIE,
  pendingCookieOptions,
  pendingCookieValue,
} from '@/lib/email-code.ts';
import { currentEnvironment, signInTestEnabled } from '@/lib/env.ts';
import { safeNext } from '@/lib/safe-next.ts';
import { cookieOptions, supabaseConfig } from '@/lib/supabase/config.ts';
import { sameOrigin } from '@/lib/supabase/route.ts';
import { sendSignInCode } from '@/lib/supabase/send-code.ts';
import { EMAIL_CODE_ACTION, passesBotCheck, RESPONSE_FIELD } from '@/lib/turnstile.ts';

/**
 * Step 1 of signing in with an email code (lib/email-code.ts): checks the bot check's answer,
 * then has Supabase Auth email a code, and remembers the address in a short-lived cookie so
 * the page asks for the code next. Lives under /auth/email/, which the firewall limits to 5
 * requests a minute per visitor (infra/vercel/firewall.json).
 */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const origin = request.nextUrl.origin;
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/sign-in-test?error=${error}`, origin), 303);

  const config = supabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const botSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!config || !secretKey || !botSecret) return back('not-configured');

  const form = await request.formData();
  const email = cleanEmail(form.get('email'));
  if (!email) return back('email');
  const human = await passesBotCheck({
    secret: botSecret,
    answer: form.get(RESPONSE_FIELD),
    hostname: request.nextUrl.hostname,
    action: EMAIL_CODE_ACTION,
    environment: currentEnvironment(),
    ip: ipAddress(request),
  });
  if (!human) return back('bot-check');

  const sent = await sendSignInCode(config.url, secretKey, email);
  if (sent !== 'sent') return back(sent === 'too-many' ? 'too-many' : 'send');

  const response = NextResponse.redirect(new URL('/sign-in-test', origin), 303);
  response.cookies.set(
    PENDING_COOKIE,
    pendingCookieValue({ email, next: safeNext(form.get('next')) }),
    pendingCookieOptions(cookieOptions.secure),
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
