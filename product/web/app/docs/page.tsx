import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Text } from '@/components/docs/text.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { type Block, guide, site } from '@/lib/api-docs/guide.ts';
import { type Call, calls, type Field, server, title, version } from '@/lib/api-docs/reference.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

export const metadata: Metadata = {
  title: 'API docs',
  description: "Hrizzup's API for bots and AI tools: the demo, on staging.",
  robots: { index: false, follow: false },
};

/**
 * The public API's docs page (PLAN.md step 3.5a): the guides (lib/api-docs/guide.ts) and every
 * public call, read from the OpenAPI file the contract makes (lib/api-docs/reference.ts), so the
 * page never says what the file doesn't. Rendered on the server in the site's stock look, with no
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

        <nav aria-label="On this page" className="mt-8 rounded-md border border-line px-4 py-3">
          <p className="font-semibold">On this page</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {guide.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
            <li>
              <a href="#calls">Every call</a>
            </li>
          </ul>
        </nav>

        <div className="mt-10 space-y-12 text-base leading-relaxed">
          {guide.map((section) => (
            <section key={section.id} id={section.id} className="space-y-4">
              <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
              {section.blocks.map((block) => (
                <GuideBlock key={JSON.stringify(block)} block={block} />
              ))}
            </section>
          ))}

          <section id="calls" className="space-y-10">
            <h2 className="text-2xl font-semibold tracking-tight">Every call</h2>
            {calls.map((call) => (
              <CallEntry key={call.id} call={call} />
            ))}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Text>{block.text}</Text>
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-2 pl-6 marker:text-muted">
          {block.items.map((item) => (
            <li key={item}>
              <Text>{item}</Text>
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="rounded-md border border-line bg-note px-4 py-3 font-mono text-sm whitespace-pre-wrap wrap-anywhere">
          {block.text}
        </pre>
      );
    case 'table':
      return (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th key={cell} className="border-b border-line py-2 pr-3 text-left align-top">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join('|')}>
                {row.map((cell) => (
                  <td key={cell} className="border-b border-line py-2 pr-3 align-top wrap-anywhere">
                    <Text>{cell}</Text>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

function Fields({ heading, fields }: { heading: string; fields: Field[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="min-w-0">
      <h4 className="font-semibold">{heading}</h4>
      <ul className="mt-1 divide-y divide-line border-y border-line text-sm">
        {fields.map((field) => (
          <li key={field.name} className="flex flex-wrap gap-x-3 py-1.5">
            <code className="font-mono font-semibold wrap-anywhere">{field.name}</code>
            <span className="min-w-0 text-muted wrap-anywhere">
              {field.kind}
              {field.required ? '' : ' (optional)'}
              {field.note ? `. ${field.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CallEntry({ call }: { call: Call }) {
  return (
    <article id={call.id} className="space-y-3 border-t border-line pt-6">
      <h3 className="font-mono text-lg font-semibold wrap-anywhere">{`${call.method} ${call.path}`}</h3>
      <p>
        {call.summary}. <strong>{call.needsKey ? 'Needs your key.' : 'Public: no key.'}</strong>
      </p>
      <Fields heading="In the address" fields={call.takes.path} />
      <Fields heading="Query" fields={call.takes.query} />
      {call.takes.body.map((variant) => (
        <Fields
          key={variant.when ?? 'body'}
          heading={variant.when ? `Body, when ${variant.when}` : 'Body (JSON)'}
          fields={variant.fields}
        />
      ))}
      <Fields heading="Answers" fields={call.answers} />
      {call.errors.length > 0 && (
        <div className="min-w-0">
          <h4 className="font-semibold">Errors</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {call.errors.map((error) => (
              <li key={`${error.status}-${error.code}`} className="wrap-anywhere">
                <code className="font-mono">
                  {error.status} {error.code}
                </code>
                : {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
