import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { cookieOptions, supabaseConfig } from './config.ts';

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * A Supabase client for route handlers and the proxy. Cookies it sets are collected and
 * then written onto whichever response the handler returns (`respond`), together with the
 * no-caching headers Supabase asks for, so a response carrying a session is never cached.
 */
export function createRouteClient(request: NextRequest) {
  const config = supabaseConfig();
  if (!config) return null;
  const pending: PendingCookie[] = [];
  const headers = new Headers();
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list, cacheHeaders) {
        for (const c of list) {
          request.cookies.set(c.name, c.value);
          pending.push(c as PendingCookie);
        }
        for (const [key, value] of Object.entries(cacheHeaders ?? {})) headers.set(key, value);
      },
    },
  });

  function respond<T extends NextResponse>(response: T): T {
    for (const c of pending) response.cookies.set(c.name, c.value, c.options);
    headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
    return response;
  }

  return { supabase, respond };
}

/** True when a form post comes from this same site (browsers always send Origin on POST). */
export function sameOrigin(request: NextRequest): boolean {
  return request.headers.get('origin') === request.nextUrl.origin;
}
