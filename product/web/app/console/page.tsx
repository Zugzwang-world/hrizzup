import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin, MARKET_ID } from '@/lib/console.ts';
import { indiaTime, STATE_NAMES } from '@/lib/console-format.ts';

export const metadata: Metadata = {
  title: 'Market console',
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ after?: string | string[] }> };

/**
 * The market console (PLAN.md step 1.7c): admins create, open, close and settle markets by hand,
 * and every step is logged. A plain internal tool, with no look of its own. Anyone but an admin,
 * signed in or not, gets "not found", as everyone does on production until launch.
 */
export default async function ConsolePage({ searchParams }: Props) {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts);
  // this is the second check.
  const admin = await consoleAdmin();
  if (!admin) notFound();
  const { after } = await searchParams;
  const page = await serverApi.admin.markets.list(
    typeof after === 'string' && MARKET_ID.test(after) ? { after } : undefined,
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold">Market console</h1>
        <p className="mt-2 text-muted">
          For admins: create, open, close and settle markets by hand. Every step is logged.
        </p>
        <p className="mt-6">
          <Link href="/console/markets/new" className="underline">
            Create a market
          </Link>
        </p>

        <h2 className="mt-10 text-xl font-semibold">Markets, newest first</h2>
        {page.markets.length === 0 ? (
          <p className="mt-4 text-muted">No markets yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {page.markets.map((market) => (
              <li key={market.id} className="py-4">
                <Link
                  href={`/console/markets/${market.id}`}
                  className="font-medium break-words underline"
                >
                  {market.question}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  <span data-testid="market-state">{STATE_NAMES[market.state]}</span> · closes{' '}
                  {indiaTime(market.closesAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {page.next && (
          <p className="mt-6">
            <Link href={`/console?after=${page.next}`} className="underline">
              Older markets
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
