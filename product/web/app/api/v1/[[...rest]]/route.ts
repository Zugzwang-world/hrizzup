import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { ResponseHeadersPlugin } from '@orpc/server/plugins';
import { SHARED_CACHE_HEADERS } from '@/lib/api/caching.ts';
import { consoleAdmin, isConsoleAddress } from '@/lib/api/console.ts';
import { crossSiteWrite } from '@/lib/api/cross-site.ts';
import { router } from '@/lib/api/router.ts';

/**
 * The typed API, served at /api/v1 (PLAN.md step 1.5c): every call in the contract
 * (product/packages/api), by its own address, on Node in Mumbai (bom1, product/web/vercel.json).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = new OpenAPIHandler(router, { plugins: [new ResponseHeadersPlugin()] });

/**
 * What the API answers for an address it doesn't have, and to anyone but an admin for every one of
 * the market console's addresses: one answer, built in one place, so the two can't be told apart
 * by their body or their headers. Its fields are in oRPC's own order, as its errors write them.
 */
function noSuchCall(): Response {
  return Response.json(
    { defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call' },
    { status: 404, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } },
  );
}

/** What a cross-site write gets: refused, never kept. */
function crossSite(): Response {
  return Response.json(
    { defined: false, code: 'FORBIDDEN', status: 403, message: 'A write must come from this site' },
    { status: 403, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } },
  );
}

async function handle(request: Request): Promise<Response> {
  if (crossSiteWrite(request)) return crossSite();
  // The market console's calls: anyone but an admin is turned away before the request is read
  // at all (oRPC decodes a body before any middleware runs, and a body that doesn't decode would
  // answer differently), with exactly the answer for an address the API doesn't have.
  const admin = isConsoleAddress(request.url) ? await consoleAdmin(request.headers) : undefined;
  if (admin === null) return noSuchCall();
  const { matched, response } = await handler.handle(request, {
    prefix: '/api/v1',
    context: { headers: request.headers, ...(admin ? { consoleAdmin: admin } : {}) },
  });
  if (!matched) return noSuchCall();
  const headers = new Headers(response.headers);
  // An error (a refused input, nobody signed in, a failure) is never kept by anyone; nor is any
  // answer whose call didn't ask to be.
  if (!response.ok) {
    for (const name of SHARED_CACHE_HEADERS) headers.delete(name);
    headers.set('Cache-Control', 'private, no-store');
  } else if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'private, no-store');
  }
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
