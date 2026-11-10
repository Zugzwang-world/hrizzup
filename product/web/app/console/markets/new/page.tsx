import { categories } from '@hrizzup/api';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateMarketForm } from '@/components/console/create-market-form.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { consoleAdmin } from '@/lib/console.ts';
import { utcToIndiaField } from '@/lib/console-format.ts';
import { newRecordId } from '@/lib/record-id.ts';

export const metadata: Metadata = {
  title: 'Create a market',
  robots: { index: false, follow: false },
};

/** A new yes-or-no market, made as a draft in the market console (admins only). */
export default async function NewMarketPage() {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts);
  // this is the second check.
  const admin = await consoleAdmin();
  if (!admin) notFound();
  const now = Date.now();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p>
          <Link href="/console" className="underline">
            Market console
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-semibold">Create a market</h1>
        <p className="mt-2 text-muted">
          A yes-or-no question, made as a draft. No money moves until it's opened, when the house
          puts in its seed.
        </p>
        <CreateMarketForm
          id={newRecordId()}
          categories={categories}
          opensAt={utcToIndiaField(new Date(now + 5 * 60_000))}
          closesAt={utcToIndiaField(new Date(now + 7 * 86_400_000))}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
