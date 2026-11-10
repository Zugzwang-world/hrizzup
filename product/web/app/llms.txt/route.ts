import { llmsText } from '@/lib/api-docs/markdown.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

/**
 * llms.txt (PLAN.md step 3.5a; llmstxt.org): the public API's short guide for AI tools, pointing at
 * the docs page, the docs as text and the OpenAPI file. Made when the site is built, from the same
 * guides and file as the docs page. Not on production until its API opens at launch.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  if (!apiDocsEnabled()) return new Response('Not found\n', { status: 404 });
  return new Response(llmsText(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
