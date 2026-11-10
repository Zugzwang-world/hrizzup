import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GuideBlock } from '@/components/docs/guide-block.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { guide, OVERVIEW, site } from '@/lib/api-docs/guide.ts';
import { calls, server, title, version } from '@/lib/api-docs/reference.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

export const metadata: Metadata = {
  title: 'API docs',
  description: "Hrizzup's API for bots and AI tools: the demo, on staging.",
  robots: { index: false, follow: false },
};

/**
 * The public API's docs page (PLAN.md step 3.5a): the demo's promise and a first call, then the
 * other guides (lib/api-docs/guide.ts) and every public call, each on a page of its own
 * (app/docs/[guide], app/docs/calls/[id]), so no page grows past what a phone shows comfortably, read from the OpenAPI file
 * the contract makes (lib/api-docs/reference.ts), so the docs never say what the file doesn't. Rendered on the server in the site's stock look, with no
 * script of its own, so it fits the page budget (Scalar's own page is about 1 MB of code, five
 * times the budget); the design chat decides its look before launch. It describes staging, the
 * demo, so production answers "not found" until its API opens.
 */
export default function ApiDocs() {
  if (!apiDocsEnabled()) notFound();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-5xl leading-tight tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-3 text-muted">
          Version {version}, at <code className="font-mono wrap-anywhere">{server}</code>: the demo,
          on staging. For AI tools: <a href={`${site}/llms.txt`}>llms.txt</a> and the{' '}
          <a href={`${server}/openapi.json`}>OpenAPI file</a>.
        </p>

        <nav aria-label="Guides" className="mt-8 rounded-md border border-line px-4 py-3">
          <p className="font-semibold">Guides</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {guide
              .filter((section) => !OVERVIEW.has(section.id))
              .map((section) => (
                <li key={section.id}>
                  <Link href={`/docs/${section.id}`}>{section.title}</Link>
                </li>
              ))}
            <li>
              <a href="#calls">Every call</a>
            </li>
          </ul>
        </nav>

        <div className="mt-10 space-y-12 text-base leading-relaxed">
          {guide
            .filter((section) => OVERVIEW.has(section.id))
            .map((section) => (
              <section key={section.id} id={section.id} className="space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
                {section.blocks.map((block) => (
                  <GuideBlock key={JSON.stringify(block)} block={block} />
                ))}
              </section>
            ))}

          <section id="calls" className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">Every call</h2>
            <p>Each call has a page of its own: what it takes, what it answers and its errors.</p>
            <ul className="divide-y divide-line border-y border-line">
              {calls.map((call) => (
                <li key={call.id} className="py-2">
                  <Link
                    href={`/docs/calls/${call.id}`}
                    className="font-mono font-semibold wrap-anywhere"
                  >
                    {`${call.method} ${call.path}`}
                  </Link>
                  <span className="block text-sm text-muted">
                    {call.summary}. {call.needsKey ? 'Needs your key.' : 'Public: no key.'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
