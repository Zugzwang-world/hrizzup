import type { ListedMarket } from '@hrizzup/api';
import Link from 'next/link';
import { serverApi } from '@/lib/api/server.ts';
import { MARKET_ID } from '@/lib/console.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { chance, noCents, yesCents } from '@/lib/sandbox/format.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

type Props = { searchParams: Promise<{ after?: string | string[] }> };

/** What a market that has finished says where its chance was. */
function finished(listed: ListedMarket): string {
  const { state, result } = listed.market;
  if (state === 'cancelled') return 'Cancelled';
  if (state === 'settled') return result === 'yes' ? 'Settled Yes' : 'Settled No';
  return 'Closed, waiting to be settled';
}

function Row({ listed }: { listed: ListedMarket }) {
  const { market, probability } = listed;
  return (
    <li>
      <Link
        href={`/sandbox/markets/${market.id}`}
        className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 no-underline hover:bg-note"
        data-testid="market-row"
      >
        <span className="min-w-0 flex-[1_1_16rem]">
          <span className="block font-medium break-words">{market.question}</span>
          <span className="block text-sm text-muted">Closes {indiaTime(market.closes_at)}</span>
        </span>
        {market.state === 'open' && probability ? (
          <>
            <span className="text-2xl font-semibold tabular-nums">{chance(probability)}</span>
            <span className="flex gap-2 font-medium tabular-nums">
              <span className="rounded-md border border-line px-3 py-2">
                Yes {yesCents(probability)}¢
              </span>
              <span className="rounded-md border border-line px-3 py-2">
                No {noCents(probability)}¢
              </span>
            </span>
          </>
        ) : (
          <span className="text-sm text-muted">
            {finished(listed)}
            {market.state === 'closed' && probability ? `, at ${chance(probability)}` : ''}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Markets, as Kalshi lists them: each a row with its question, its chance and its Yes and No
 * prices, the open ones first. Every row opens the market's own page.
 */
export default async function SandboxMarkets({ searchParams }: Props) {
  sandboxOnly();
  const { after } = await searchParams;
  const page = await serverApi.markets.list(
    typeof after === 'string' && MARKET_ID.test(after) ? { after } : undefined,
  );
  const open = page.markets.filter((listed) => listed.market.state === 'open');
  const rest = page.markets.filter((listed) => listed.market.state !== 'open');

  return (
    <>
      <h1 className="text-3xl font-semibold">Markets</h1>
      <p className="mt-2 max-w-2xl text-muted">
        A plain working copy of Kalshi's layout, to try the markets with play money. Every market
        here is a test market with a placeholder question.
      </p>

      <h2 className="mt-8 text-xl font-semibold">Open</h2>
      {open.length === 0 ? (
        <p className="mt-4 text-muted">No open markets on this page.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="market-list">
          {open.map((listed) => (
            <Row key={listed.market.id} listed={listed} />
          ))}
        </ul>
      )}

      {rest.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold">Closed and settled</h2>
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {rest.map((listed) => (
              <Row key={listed.market.id} listed={listed} />
            ))}
          </ul>
        </>
      )}

      {page.next && (
        <p className="mt-6">
          <Link
            href={`/sandbox?after=${page.next}`}
            className="inline-flex min-h-11 items-center underline"
          >
            Older markets
          </Link>
        </p>
      )}
    </>
  );
}
