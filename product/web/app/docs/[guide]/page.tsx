import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GuideBlock } from '@/components/docs/guide-block.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { guide, OVERVIEW } from '@/lib/api-docs/guide.ts';
import { apiDocsEnabled } from '@/lib/env.ts';

/**
 * One of the public API's guides (PLAN.md step 3.5a) on a page of its own: the ground rules, moving
 * from Manifold, AI tools, the changelog (lib/api-docs/guide.ts). Made when the site is built. Like
 * the docs page, not on production until its API opens at launch.
 */
export const dynamicParams = false;

const pages = guide.filter((section) => !OVERVIEW.has(section.id));

export function generateStaticParams() {
  return pages.map((section) => ({ guide: section.id }));
}

type Props = { params: Promise<{ guide: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { guide: id } = await params;
  const section = pages.find((s) => s.id === id);
  return {
    title: section ? `${section.title}: API docs` : 'API docs',
    robots: { index: false, follow: false },
  };
}

export default async function ApiGuide({ params }: Props) {
  if (!apiDocsEnabled()) notFound();
  const { guide: id } = await params;
  const section = pages.find((s) => s.id === id);
  if (!section) notFound();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <p className="mb-6">
          <Link href="/docs">API docs</Link>
        </p>
        <h1 className="font-display text-5xl leading-tight tracking-tight">{section.title}</h1>
        <div className="mt-8 space-y-4 text-base leading-relaxed">
          {section.blocks.map((block) => (
            <GuideBlock key={JSON.stringify(block)} block={block} />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
