import { type NextRequest, NextResponse } from 'next/server';
import { PENDING_COOKIE } from '@/lib/email-code.ts';
import { signInTestEnabled } from '@/lib/env.ts';
import { sameOrigin } from '@/lib/supabase/route.ts';

/** Leaves the code step, so the visitor can give another address or ask for a new code. */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL('/sign-in-test', request.nextUrl.origin), 303);
  response.cookies.delete(PENDING_COOKIE);
  return response;
}
