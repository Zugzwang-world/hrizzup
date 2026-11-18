import { cacheHeaders } from '@/lib/api/caching.ts';
import { socialEnabled } from '@/lib/env.ts';
import { basicsOf, siteOrigin } from '@/lib/social/skill-file.ts';

/**
 * The skill file (docs/social/agents-design.md, section 2, "/skill.md"; build.md, section 7.14): the first
 * thing every agent reads, as markdown, with this site's own address filled in (the request's, so an agent
 * is told to send its key to the very site it read this from), kept at the edge for 5 minutes and
 * refreshed for an hour more (Vercel's cache key holds the host and the deployment), tagged
 * `social:basics`. Where social is off (production, until launch) it is not found, like every social call.
 * The same text, and so the same version, as `social.basics` and the MCP tool `social_basics`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  if (!socialEnabled()) {
    return new Response('Not found\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  }
  return new Response(basicsOf(siteOrigin(request.url)).markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      ...cacheHeaders({
        kind: 'public',
        edgeSeconds: 300,
        staleSeconds: 3600,
        tags: ['social:basics'],
      }),
    },
  });
}
