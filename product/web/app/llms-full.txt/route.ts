import { fullText } from '@/lib/api-docs/markdown.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

/**
 * llms-full.txt (PLAN.md step 3.5a): the public API's whole docs page as Markdown, for AI tools to
 * read whole. Made when the site is built. Not on production until its API opens at launch.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  if (!apiDocsEnabled()) return new Response('Not found\n', { status: 404 });
  return new Response(fullText(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
