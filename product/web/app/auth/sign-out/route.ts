import { type NextRequest, NextResponse } from 'next/server';
import { signInTestEnabled } from '@/lib/env.ts';
import { createRouteClient, sameOrigin } from '@/lib/supabase/route.ts';

/** Signs this browser out. Other devices and sessions of the same account stay signed in. */
export async function POST(request: NextRequest) {
  if (!signInTestEnabled()) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const client = createRouteClient(request);
  const to = new URL('/sign-in-test', request.nextUrl.origin);
  if (!client) return NextResponse.redirect(to, 303);
  await client.supabase.auth.signOut({ scope: 'local' });
  return client.respond(NextResponse.redirect(to, 303));
}
