import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin, MARKET_ID } from '@/lib/console.ts';
import { indiaTime, MODE_NAMES, STATE_NAMES } from '@/lib/console-format.ts';

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
  const [page, perps] = await Promise.all([
    serverApi.admin.markets.list(
      typeof after === 'string' && MARKET_ID.test(after) ? { after } : undefined,
    ),
    // The perps: the Bitcoin perp, then the check runs' newest test perps (PLAN.md step 3.4a).
    serverApi.admin.perps.list(),
  ]);
  const shownPerps = [
    ...perps.perps.filter((perp) => perp.listed),
    ...perps.perps.filter((perp) => !perp.listed && perp.state === 'live').slice(0, 10),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold">Market console</h1>
        <p className="mt-2 text-muted">
          For admins: create, open, close and settle markets by hand, and run the perp. Every step
          is logged.
        </p>
        <p className="mt-6">
          <Link href="/console/markets/new" className="underline">
            Create a market
          </Link>
        </p>

        <h2 className="mt-10 text-xl font-semibold">Perps</h2>
        <p className="mt-2 text-sm text-muted">
          The off switch, the settings and the rule-change log; each check run's own test perps are
          unlisted, the newest live ones shown here.
        </p>
        {shownPerps.length === 0 ? (
          <p className="mt-4 text-muted">No perps yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line" data-testid="perp-list">
            {shownPerps.map((perp) => (
              <li key={perp.id} className="py-4">
                <Link
                  href={`/console/perps/${perp.id}`}
                  className="font-medium break-words underline"
                >
                  {perp.name}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  <span data-testid="perp-mode">{MODE_NAMES[perp.tradingMode]}</span>
                  {!perp.listed && ' · unlisted'}
                  {perp.openPositions > 0 && ` · ${perp.openPositions} open`}
                </p>
              </li>
            ))}
          </ul>
        )}

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
                  {!market.listed && ' · unlisted'}
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
