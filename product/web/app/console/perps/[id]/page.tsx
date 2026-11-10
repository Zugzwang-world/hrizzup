import type { ConsolePerpWithLog, RuleChange } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PerpModeForm, PerpSettingsForm } from '@/components/console/perp-actions.tsx';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { consoleAdmin, MARKET_ID } from '@/lib/console.ts';
import { dollars, indiaTime, MODE_NAMES, money, ruleValue } from '@/lib/console-format.ts';

export const metadata: Metadata = {
  title: 'Perp',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

/** What each line of the rule-change log is about, in words. */
const RULES: Record<RuleChange['rule'], string> = {
  created: 'Made',
  stand_in: 'Stand-in price',
  trading_mode: 'The off switch',
  max_leverage: 'Most leverage',
  taker_fee_bps: 'Opening fee (basis points)',
  taker_fee_impact: 'Size fee',
  funding_period_ms: 'Funding period (milliseconds)',
  funding_sensitivity: 'Funding sensitivity',
  max_funding_rate: 'Most funding a period',
  max_price_age_ms: 'Oldest price allowed (milliseconds)',
  subsidy_long: "The house's money in the long pool",
  subsidy_short: "The house's money in the short pool",
  funding_from: 'First funding period starts',
  retired: 'Retired',
};

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

async function perpOr404(id: string): Promise<ConsolePerpWithLog> {
  try {
    return await serverApi.admin.perps.get({ id });
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/**
 * One perp in the console (admins only; PLAN.md step 3.4a): its off switch (Manifold's trading
 * modes), its settings and its money, and the rule-change log, every change with when, who and why.
 */
export default async function ConsolePerpPage({ params }: Props) {
  // The proxy has already given anyone but an admin the site's own "not found" page (proxy.ts);
  // this is the second check.
  const admin = await consoleAdmin();
  if (!admin) notFound();
  const { id } = await params;
  if (!MARKET_ID.test(id)) notFound();
  const perp = await perpOr404(id);
  const live = perp.state === 'live';

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p>
          <Link href="/console" className="underline">
            Market console
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-semibold break-words">{perp.name}</h1>
        <p className="mt-2 text-lg">
          <span data-testid="perp-mode">{live ? MODE_NAMES[perp.tradingMode] : 'Retired'}</span>
          {perp.pausedReason && (
            <span data-testid="perp-paused"> · paused: {perp.pausedReason}</span>
          )}
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
          <Detail term="Public list">
            <span data-testid="perp-listed">
              {perp.listed
                ? 'Listed'
                : "Unlisted: a check run's test perp, reached only by its address"}
            </span>
          </Detail>
          <Detail term="Price">
            {perp.price && perp.priceAt
              ? perp.feed === 'btc-usd'
                ? `${dollars(perp.price)}, asked for at ${indiaTime(perp.priceAt)}`
                : `${dollars(perp.price)}, from the 5-second step starting ${indiaTime(perp.priceAt)}`
              : 'No price applied yet: the first trade or check applies one'}
          </Detail>
          <Detail term="Price from">
            {perp.feed === 'btc-usd' ? (
              'Our own Bitcoin price: every 5 seconds, the median of Coinbase, Kraken and Bitstamp, Gemini standing by'
            ) : (
              <>
                {perp.feed === 'stand-in-btc-usd' ? 'The stand-in price' : perp.feed}: from{' '}
                {indiaTime(perp.standIn.origin)} at {dollars(perp.standIn.startPrice)}, moving{' '}
                {perp.standIn.volatility} a year,{' '}
                {perp.standIn.ownSeed
                  ? 'with a seed of its own'
                  : "with the environment's secret seed"}
              </>
            )}
          </Detail>
          <Detail term="Pools">
            <span data-testid="perp-pools">
              {money(perp.pools.long)} long, {money(perp.pools.short)} short
            </span>
          </Detail>
          <Detail term="Open positions">
            {perp.openPositions} ({perp.openInterest.long} long, {perp.openInterest.short} short, in
            size)
          </Detail>
          <Detail term="Funding">
            {perp.lastFundingAt
              ? `last ran ${indiaTime(perp.lastFundingAt)}`
              : `not yet run; its first period started ${indiaTime(perp.fundingFrom)}`}
          </Detail>
          <Detail term="Steps run">{perp.steps}</Detail>
          <Detail term="Made by">
            {perp.createdBy
              ? (perp.createdBy.email ?? perp.createdBy.id)
              : 'A migration (the founder’s first settings)'}
          </Detail>
          {perp.retiredAt && <Detail term="Retired">{indiaTime(perp.retiredAt)}</Detail>}
        </dl>

        {live ? (
          <>
            <h2 className="mt-10 text-xl font-semibold">The off switch</h2>
            <div className="mt-4">
              <PerpModeForm id={perp.id} mode={perp.tradingMode} />
            </div>
            <h2 className="mt-10 text-xl font-semibold">Settings</h2>
            <p className="mt-2 text-sm text-muted">
              The house put {money(perp.settings.subsidyLong)} into the long pool and{' '}
              {money(perp.settings.subsidyShort)} into the short pool when the perp was made; those
              never change.
            </p>
            <div className="mt-4">
              <PerpSettingsForm id={perp.id} settings={perp.settings} />
            </div>
          </>
        ) : (
          <p className="mt-10 text-muted">Nothing more to do: it's retired.</p>
        )}

        <h2 className="mt-10 text-xl font-semibold">Rule-change log</h2>
        <ol className="mt-4 divide-y divide-line border-y border-line" data-testid="perp-log">
          {perp.log.map((line) => (
            <li key={line.id} className="py-3">
              <p className="break-words">
                <span className="font-medium">{RULES[line.rule]}:</span>{' '}
                {line.oldValue !== null && <>{ruleValue(line.rule, line.oldValue)} to </>}
                {ruleValue(line.rule, line.newValue)}
              </p>
              <p className="text-sm break-words text-muted">
                {line.by ? `by ${line.by.email ?? line.by.id}` : 'by a migration'},{' '}
                {indiaTime(line.at)}. Why: {line.reason}
              </p>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </div>
  );
}
