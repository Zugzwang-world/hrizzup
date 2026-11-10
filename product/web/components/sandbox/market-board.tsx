'use client';

import type { Market } from '@hrizzup/agreement';
import type { OpenOrder } from '@hrizzup/api';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { cancelOrderAction } from '@/app/sandbox/actions.ts';
import { BUTTON } from '@/components/console/controls.tsx';
import { indiaTime, money, STATE_NAMES } from '@/lib/console-format.ts';
import { chance, justAbove, type LinePoint, plain } from '@/lib/sandbox/format.ts';
import { TradePanel } from './trade-panel.tsx';
import { PriceLine } from './ui.tsx';

/** How often the page asks for the market's chance again (the list is kept at the edge, cleared when a trade moves it). */
const POLL_MS = 10_000;
/** The most readings the price line keeps: about an hour. */
const MOST_READINGS = 360;

type Props = {
  market: Market;
  /** The first category's name, for the label above the question. */
  category: string;
  probability: string | null;
  signedIn: boolean;
  balance: string | null;
  position: { yes: string; no: string } | null;
  orders: OpenOrder[];
};

/** What a market that has finished says: "Settled Yes", "Cancelled". */
function stateText(market: Market): string {
  if (market.state === 'settled') return `Settled ${market.result === 'yes' ? 'Yes' : 'No'}`;
  return STATE_NAMES[market.state] ?? market.state;
}

/**
 * One market's page, as Kalshi's is laid out: the question, the chance and a small price line (drawn
 * from what the page has seen since it opened, asking again every 10 seconds) on the left; the trade
 * panel on the right; below, the account's position here, its resting limit orders and the rules.
 */
export function MarketBoard({
  market,
  category,
  probability,
  signedIn,
  balance,
  position,
  orders,
}: Props) {
  const router = useRouter();
  const [chanceNow, setChanceNow] = useState(probability);
  const [points, setPoints] = useState<LinePoint[]>(() =>
    probability ? [{ at: Date.now(), value: Number(probability) }] : [],
  );
  const [pending, setPending] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);

  /** A reading of the chance: kept when it moved, or when asked to (a poll, to stretch the line to now). */
  const read = useCallback((next: string | null, every = false) => {
    setChanceNow(next);
    if (next === null) return;
    setPoints((before) => {
      if (!every && before.at(-1)?.value === Number(next)) return before;
      return [...before, { at: Date.now(), value: Number(next) }].slice(-MOST_READINGS);
    });
  }, []);

  // The page is read again after a trade: follow the new chance.
  useEffect(() => read(probability), [probability, read]);

  const live = market.state === 'open' || market.state === 'closed';
  useEffect(() => {
    const above = justAbove(market.id);
    if (!live || !above) return;
    let stopped = false;
    async function ask() {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/v1/markets?after=${above}`, {
          headers: { accept: 'application/json' },
        });
        if (!response.ok || stopped) return;
        const body = (await response.json()) as {
          markets: { market: { id: string; state: string }; probability: string | null }[];
        };
        const first = body.markets[0];
        if (!first || first.market.id !== market.id) return;
        // Opened, closed or settled by an admin: the whole page changes with it.
        if (first.market.state !== market.state) router.refresh();
        else read(first.probability, true);
      } catch {
        // The next ask tries again.
      }
    }
    const timer = setInterval(ask, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [live, market.id, market.state, read, router]);

  async function cancel(order: OpenOrder) {
    setPending(order.id);
    setAnswer(null);
    try {
      setAnswer(
        await cancelOrderAction({
          marketId: market.id,
          orderId: order.id,
          requestId: crypto.randomUUID(),
        }),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="market-question" className="min-w-0 lg:col-start-1">
        <p className="text-sm font-semibold tracking-wide text-muted uppercase">{category}</p>
        <h1 id="market-question" className="mt-1 text-3xl font-semibold break-words">
          {market.question}
        </h1>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-5xl font-semibold tabular-nums" data-testid="market-chance">
            {chanceNow ? chance(chanceNow) : '–'}
          </span>
          <span className="text-muted">chance</span>
        </p>
        <p className="mt-1 text-muted" data-testid="market-state">
          {stateText(market)} · closes {indiaTime(market.closes_at)}
        </p>
        <div className="mt-6">
          <PriceLine
            points={points}
            label="The chance of Yes since this page opened"
            show={(value) => `${Math.round(value * 100)}%`}
            floor={0}
            ceiling={1}
          />
        </div>
      </section>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
        <TradePanel
          marketId={market.id}
          open={market.state === 'open'}
          signedIn={signedIn}
          chanceNow={chanceNow}
          balance={balance}
          position={position}
        />
      </aside>

      <section aria-labelledby="your-position" className="min-w-0 lg:col-start-1">
        <h2 id="your-position" className="text-xl font-semibold">
          Your position
        </h2>
        {signedIn ? (
          <>
            <dl className="mt-3 grid gap-1 tabular-nums sm:max-w-xs">
              <div className="flex flex-wrap justify-between gap-x-6">
                <dt className="text-muted">Yes shares</dt>
                <dd data-testid="position-yes">{plain(position?.yes ?? '0')}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6">
                <dt className="text-muted">No shares</dt>
                <dd data-testid="position-no">{plain(position?.no ?? '0')}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6">
                <dt className="text-muted">Balance</dt>
                <dd>{balance === null ? '–' : money(balance)}</dd>
              </div>
            </dl>
            <h3 className="mt-6 font-semibold">Resting limit orders</h3>
            {orders.length === 0 ? (
              <p className="mt-2 text-muted">None. A limit order that has not filled rests here.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="orders">
                {orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                    <p className="min-w-0 flex-[1_1_14rem] break-words">
                      Buy {order.outcome === 'yes' ? 'Yes' : 'No'}: up to {money(order.orderAmount)}{' '}
                      while the chance of Yes is {order.outcome === 'yes' ? 'at most' : 'at least'}{' '}
                      {chance(order.limitProb)}.
                      <span className="block text-sm text-muted">
                        Spent {money(order.amount)} for {plain(order.shares)} shares so far
                        {order.expiresAt ? `; runs out ${indiaTime(order.expiresAt)}` : ''}.
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => cancel(order)}
                      className={BUTTON}
                    >
                      {pending === order.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {answer && (
              <p
                role="status"
                data-testid="cancel-answer"
                className="mt-3 rounded-md border border-line bg-note px-4 py-3 break-words"
              >
                {answer.message}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-muted">Sign in to see your position and your orders.</p>
        )}
      </section>

      <section aria-labelledby="market-rules" className="min-w-0 lg:col-start-1">
        <h2 id="market-rules" className="text-xl font-semibold">
          Rules
        </h2>
        <p className="mt-2 break-words whitespace-pre-line">{market.rules}</p>
        <p className="mt-3 text-sm text-muted break-words">Source: {market.source.name}</p>
      </section>
    </div>
  );
}
