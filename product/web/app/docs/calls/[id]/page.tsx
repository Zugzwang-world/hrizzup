import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CallEntry } from '@/components/docs/call.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { calls, server } from '@/lib/api-docs/reference.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

/**
 * One call of the public API (PLAN.md step 3.5a), on a page of its own: its address, whether it
 * needs a key, what it takes, what it answers and its errors, read from the OpenAPI file. Made
 * when the site is built, one page a call. Like the docs page, not on production until its API
 * opens at launch.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return calls.map((call) => ({ id: call.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const call = calls.find((c) => c.id === id);
  return {
    title: call ? `${call.method} ${call.path}: API docs` : 'API docs',
    robots: { index: false, follow: false },
  };
}

export default async function ApiCall({ params }: Props) {
  if (!apiDocsEnabled()) notFound();
  const { id } = await params;
  const call = calls.find((c) => c.id === id);
  if (!call) notFound();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <p className="mb-6">
          <Link href="/docs">API docs</Link> ·{' '}
          <code className="font-mono wrap-anywhere">{server}</code>
        </p>
        <CallEntry call={call} />
      </main>
      <SiteFooter />
    </div>
  );
}
