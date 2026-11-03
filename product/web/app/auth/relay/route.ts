import { type NextRequest, NextResponse } from 'next/server';
import { relayTarget, STAGING_ORIGIN } from '@/lib/auth-relay.ts';
import { currentEnvironment } from '@/lib/env.ts';

/**
 * Staging's sign-in relay for previews (see lib/auth-relay.ts). Supabase returns a
 * preview's visitor here with the one-time code; it is forwarded only to the preview named
 * in a correctly signed, recent note. Exists on staging only.
 */
export function GET(request: NextRequest) {
  const secret = process.env.AUTH_RELAY_SECRET;
  if (currentEnvironment() !== 'staging' || !secret) return new NextResponse(null, { status: 404 });
  const target = relayTarget(secret, request.nextUrl.searchParams);
  if (!target) {
    return NextResponse.redirect(new URL('/sign-in-test?error=relay', STAGING_ORIGIN), 303);
  }
  return NextResponse.redirect(target, 303);
}
