import openapi from '@hrizzup/api/openapi.json' with { type: 'json' };
import { apiDocsEnabled } from '@/lib/env.ts';

/**
 * The public API's OpenAPI file (PLAN.md step 3.5a), served as the repository keeps it
 * (product/packages/api/openapi.json, made from the contract and checked on every pull request).
 * Made when the site is built, so it's the deployment's own. Not on production until its API opens.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  if (!apiDocsEnabled()) {
    return Response.json(
      { defined: false, code: 'NOT_FOUND', status: 404, message: 'No such call' },
      { status: 404 },
    );
  }
  return Response.json(openapi, { headers: { 'Access-Control-Allow-Origin': '*' } });
}
