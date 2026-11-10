import { type ConsoleLogLine, type ConsoleMarketWithLog, categories } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketActions } from '@/components/console/market-actions.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin, MARKET_ID } from '@/lib/console.ts';
import { indiaTime, money, percent, STATE_NAMES } from '@/lib/console-format.ts';

export const metadata: Metadata = {
  title: 'Market',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

const CATEGORY_NAMES = new Map(categories.map((c) => [c.code, c.name]));

const ACTIONS: Record<ConsoleLogLine['action'], string> = {
  create: 'Created',
  open: 'Opened',
  close: 'Closed',
  settle: 'Settled',
};

/** How a market was settled, in words. */
function settledAs(outcome: string, probability: string | null): string {
  if (outcome === 'yes') return 'Yes';
  if (outcome === 'no') return 'No';
  if (outcome === 'probability') return `At ${percent(probability ?? '0')} Yes`;
  return 'Cancelled';
}

/** Who did something, by their account's email (or its ID, once the account is gone). */
function who(line: { by: { id: string; email: string | null } }): string {
  return line.by.email ?? `an account since removed (${line.by.id})`;
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

async function marketOr404(id: string): Promise<ConsoleMarketWithLog> {
  try {
    return await serverApi.admin.markets.get({ id });
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** One market in the market console (admins only): what it is, its money, what's next, its log. */
export default async function ConsoleMarketPage({ params }: Props) {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts);
  // this is the second check.
  const admin = await consoleAdmin();
  if (!admin) notFound();
  const { id } = await params;
  if (!MARKET_ID.test(id)) notFound();
  const market = await marketOr404(id);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p>
          <Link href="/console" className="underline">
            Market console
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-semibold break-words">{market.question}</h1>
        <p className="mt-2 text-lg">
          <span data-testid="market-state">{STATE_NAMES[market.state]}</span>
          {market.result && (
            <span data-testid="market-result">
              {' '}
              · {settledAs(market.result.outcome, market.result.probability)}
              {market.result.cancelReason ? `: ${market.result.cancelReason}` : ''}
            </span>
          )}
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
          <Detail term="Categories">
            {market.categories.map((code) => CATEGORY_NAMES.get(code) ?? code).join(', ')}
          </Detail>
          <Detail term="Rules">
            <span className="whitespace-pre-line">{market.rules}</span>
          </Detail>
          <Detail term="Settlement source">
            {market.source.name}
            {market.source.url && (
              <>
                {' '}
                (
                <a
                  href={market.source.url}
                  rel="noopener noreferrer nofollow"
                  className="underline"
                >
                  {market.source.url}
                </a>
                )
              </>
            )}
          </Detail>
          <Detail term={market.state === 'draft' ? 'Opens (planned)' : 'Opened'}>
            {indiaTime(market.opensAt)}
          </Detail>
          <Detail term={market.state === 'draft' || market.state === 'open' ? 'Closes' : 'Closed'}>
            {indiaTime(market.closesAt)}
          </Detail>
          <Detail term="Starting probability">{percent(market.startingProbability)}</Detail>
          <Detail term="The house's seed">{money(market.seed)}</Detail>
          {market.probability && (
            <Detail term="Probability now">{percent(market.probability)}</Detail>
          )}
          <Detail term="Money it holds">
            <span data-testid="market-held">{money(market.held)}</span>
          </Detail>
          <Detail term="Trades">{market.trades}</Detail>
          <Detail term="Created by">{market.createdBy.email ?? market.createdBy.id}</Detail>
        </dl>

        <h2 className="mt-10 text-xl font-semibold">Next</h2>
        <div className="mt-4">
          <MarketActions id={market.id} state={market.state} />
        </div>

        <h2 className="mt-10 text-xl font-semibold">Log</h2>
        <ol className="mt-4 divide-y divide-line border-y border-line" data-testid="market-log">
          {market.log.map((line) => (
            <li key={line.id} className="py-3">
              <p className="break-words">
                <span className="font-medium">
                  {ACTIONS[line.action]}
                  {line.settlement
                    ? `: ${settledAs(line.settlement.outcome, line.settlement.probability)}`
                    : ''}
                </span>{' '}
                <span className="text-muted">
                  by {who(line)}, {indiaTime(line.at)}
                </span>
              </p>
              {line.settlement && (
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  <Detail term="Evidence">
                    <span className="whitespace-pre-line">{line.settlement.evidence}</span>
                  </Detail>
                  {line.settlement.reason && <Detail term="Why">{line.settlement.reason}</Detail>}
                  <Detail term="Paid">
                    <span data-testid="settlement-paid">
                      {money(line.settlement.paidToPeople)} to {line.settlement.people}{' '}
                      {line.settlement.people === 1 ? 'person' : 'people'}, and{' '}
                      {money(line.settlement.toHouse)} to the house: all the market held
                    </span>
                  </Detail>
                </dl>
              )}
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
}
