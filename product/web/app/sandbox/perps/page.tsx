import Link from 'next/link';
import { serverApi } from '@/lib/api/server.ts';
import { MODE_NAMES } from '@/lib/console-format.ts';
import { ratePercent, usd } from '@/lib/sandbox/format.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

/** The listed perps, as Kalshi's perps list shows them: today there is one, the Bitcoin perp. */
export default async function SandboxPerps() {
  sandboxOnly();
  const { perps } = await serverApi.perps.list();

  return (
    <>
      <h1 className="text-3xl font-semibold">Perps</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Go up or down on a price with play money and a multiplier of 1 to 10 times.{' '}
        {perps.some((perp) => perp.feed === 'btc-usd')
          ? 'The price is Bitcoin’s, in US dollars: every 5 seconds, the median of three big exchanges’ prices.'
          : 'On staging the price is a stand-in that moves every 5 seconds, until the real feed.'}
      </p>
      {perps.length === 0 ? (
        <p className="mt-6 text-muted">No perps are listed here.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line" data-testid="perp-list">
          {perps.map((perp) => (
            <li key={perp.id}>
              <Link
                href={`/sandbox/perps/${perp.id}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 no-underline hover:bg-note"
              >
                <span className="min-w-0 flex-[1_1_14rem]">
                  <span className="block font-medium break-words">{perp.name}</span>
                  <span className="block text-sm text-muted">
                    {MODE_NAMES[perp.tradingMode]} · funding {ratePercent(perp.fundingRate)}
                  </span>
                </span>
                <span className="text-xl font-semibold tabular-nums wrap-anywhere sm:text-2xl">
                  {usd(perp.price)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
