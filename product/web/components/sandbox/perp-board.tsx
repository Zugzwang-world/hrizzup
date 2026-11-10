'use client';

import type { HeldPerpPosition, PerpDetails, PerpPositionsPage } from '@hrizzup/api';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { closePerpAction, openPerpAction } from '@/app/sandbox/actions.ts';
import { BUTTON, FIELD } from '@/components/console/controls.tsx';
import { indiaTime, MODE_NAMES } from '@/lib/console-format.ts';
import {
  change,
  type LinePoint,
  liquidationAbout,
  mostMargin,
  plainAmount,
  ratePercent,
  roughMoney,
  shareOf,
  short,
  signed,
  times,
  typedAmount,
  usd,
} from '@/lib/sandbox/format.ts';
import { Choice, PRIMARY, PriceLine, QuickAmount } from './ui.tsx';

/** A new price comes every 5 seconds; the page asks again at the same pace. */
const POLL_MS = 5_000;
/** The most prices the line keeps: about an hour. */
const MOST_PRICES = 720;

type Direction = 'long' | 'short';
const WAY: Record<Direction, string> = { long: 'Up', short: 'Down' };

/**
 * The Bitcoin perp's page, as Kalshi's perp page is laid out: price and change, open interest and
 * funding, a small price line (from the prices the page has seen since it opened, a new one every 5
 * seconds), the panel to open an Up or Down position, then the account's open positions.
 */
export function PerpBoard({
  initial,
  signedIn,
  balance: firstBalance,
  positions: firstPositions,
}: {
  initial: PerpDetails;
  signedIn: boolean;
  balance: string | null;
  positions: HeldPerpPosition[];
}) {
  const [perp, setPerp] = useState(initial);
  const [balance, setBalance] = useState(firstBalance);
  const [held, setHeld] = useState(firstPositions.filter((p) => p.perpId === initial.id));
  const [points, setPoints] = useState<LinePoint[]>(() => [
    { at: Date.parse(initial.priceAt), value: Number(initial.price) },
  ]);

  const [direction, setDirection] = useState<Direction>('long');
  const [margin, setMargin] = useState('');
  const [leverage, setLeverage] = useState(3);
  const [pending, setPending] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);

  const id = initial.id;

  /** Asks for the perp's price now, and (signed in) the account's positions, and keeps what came. */
  const refresh = useCallback(async () => {
    const headers = { accept: 'application/json' };
    try {
      const [priceAnswer, mineAnswer] = await Promise.all([
        fetch(`/api/v1/perps/${id}`, { headers }),
        signedIn ? fetch('/api/v1/me/perps', { headers }) : Promise.resolve(null),
      ]);
      if (priceAnswer.ok) {
        const next = (await priceAnswer.json()) as PerpDetails;
        setPerp(next);
        const at = Date.parse(next.priceAt);
        setPoints((before) =>
          before.at(-1)?.at === at
            ? before
            : [...before, { at, value: Number(next.price) }].slice(-MOST_PRICES),
        );
      }
      if (mineAnswer?.ok) {
        const mine = (await mineAnswer.json()) as PerpPositionsPage;
        setBalance(mine.balance);
        setHeld(mine.positions.filter((position) => position.perpId === id));
      }
    } catch {
      // The next ask tries again.
    }
  }, [id, signedIn]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const price = Number(perp.price);
  const first = points[0]?.value ?? price;
  const most = Math.min(10, Number(perp.settings.maxLeverage) || 10);
  const typedMargin = Number(typedAmount(margin));
  const size = typedMargin * leverage;
  const fee = (size * Number(perp.settings.takerFeeBps)) / 10_000;
  const topMargin = balance === null ? 0 : mostMargin(balance, leverage, perp.settings.takerFeeBps);
  const open = perp.tradingMode === 'enabled';
  const up = Number(perp.openInterest.long);
  const down = Number(perp.openInterest.short);
  const rate = Number(perp.fundingRate);

  async function openPosition(event: React.FormEvent) {
    event.preventDefault();
    setPending('open');
    setAnswer(null);
    try {
      const result = await openPerpAction({
        perpId: id,
        requestId: crypto.randomUUID(),
        direction,
        margin,
        leverage: String(leverage),
      });
      setAnswer(result);
      if (result.ok) setMargin('');
      await refresh();
    } finally {
      setPending(null);
    }
  }

  async function close(position: HeldPerpPosition) {
    setPending(position.id);
    setAnswer(null);
    try {
      setAnswer(
        await closePerpAction({
          perpId: id,
          requestId: crypto.randomUUID(),
          direction: position.direction,
        }),
      );
      await refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="perp-name" className="min-w-0 lg:col-start-1">
        <p className="text-sm font-semibold tracking-wide text-muted uppercase">
          Perps · Up or down
        </p>
        <h1 id="perp-name" className="mt-1 text-3xl font-semibold break-words">
          {perp.name}
        </h1>
        <p className="mt-4 text-5xl font-semibold tabular-nums" data-testid="perp-price">
          {usd(perp.price)}
        </p>
        <p className="mt-1 text-muted tabular-nums" data-testid="perp-change">
          {change(first, price)} since this page opened
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm tabular-nums sm:max-w-md">
          <dt className="text-muted">Open interest</dt>
          <dd data-testid="perp-oi">
            {roughMoney(up + down)} (Up {roughMoney(up)}, Down {roughMoney(down)})
          </dd>
          <dt className="text-muted">Funding</dt>
          <dd data-testid="perp-funding">
            {ratePercent(perp.fundingRate)} an hour
            {rate > 0 ? ' (Up pays Down)' : rate < 0 ? ' (Down pays Up)' : ''}
          </dd>
          <dt className="text-muted">Next funding</dt>
          <dd>{indiaTime(perp.nextFundingAt)}</dd>
          <dt className="text-muted">Trading</dt>
          <dd data-testid="perp-mode">{MODE_NAMES[perp.tradingMode]}</dd>
        </dl>
        <div className="mt-6">
          <PriceLine points={points} label="The price since this page opened" show={usd} />
        </div>
      </section>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
        <section aria-labelledby="open-heading" className="rounded-lg border border-line p-5">
          <h2 id="open-heading" className="text-xl font-semibold">
            Open
          </h2>
          {!open && (
            <p className="mt-3 rounded-md border border-line bg-note px-4 py-3" role="status">
              {perp.tradingMode === 'reduce-only'
                ? 'Closing only: no new positions can be opened.'
                : 'Trading is off: nothing opens or closes.'}
            </p>
          )}
          <form
            onSubmit={openPosition}
            className="mt-4 grid grid-cols-1 gap-4"
            data-testid="perp-form"
          >
            <Choice
              label="Up or Down"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'long', text: 'Up' },
                { value: 'short', text: 'Down' },
              ]}
              testId="perp-direction"
            />
            <p className="text-sm text-muted">
              Invest account ·{' '}
              {balance === null ? 'sign in to see it' : `${short(balance)} available`}
            </p>
            <div>
              <label htmlFor="perp-margin" className="font-medium">
                Cost (Ṁ)
              </label>
              <input
                id="perp-margin"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
                className={`${FIELD} tabular-nums`}
              />
              {balance !== null && (
                <div className="mt-2 flex gap-2">
                  {[25, 50].map((percent) => (
                    <QuickAmount
                      key={percent}
                      onClick={() => setMargin(shareOf(balance, percent, topMargin))}
                    >
                      {percent}%
                    </QuickAmount>
                  ))}
                  <QuickAmount onClick={() => setMargin(plainAmount(topMargin))}>Max</QuickAmount>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="perp-leverage" className="flex justify-between gap-4 font-medium">
                <span>Multiplier</span>
                <span className="tabular-nums" data-testid="perp-multiplier">
                  {times(leverage)}
                </span>
              </label>
              <input
                id="perp-leverage"
                type="range"
                min={1}
                max={most}
                step={0.1}
                value={leverage}
                onChange={(event) => setLeverage(Number(event.target.value))}
                className="mt-2 block min-h-11 w-full min-w-0 accent-accent"
              />
            </div>
            <dl className="grid gap-1 text-sm tabular-nums">
              <div className="flex flex-wrap justify-between gap-x-4">
                <dt className="text-muted">Size about</dt>
                <dd>{typedMargin > 0 ? roughMoney(size) : '–'}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-4">
                <dt className="text-muted">Opening fee about</dt>
                <dd>{typedMargin > 0 ? roughMoney(fee) : '–'}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-4">
                <dt className="text-muted">Liquidated at about</dt>
                <dd data-testid="perp-liquidation">
                  {usd(liquidationAbout(direction, price, leverage))}
                </dd>
              </div>
            </dl>
            {signedIn ? (
              <button
                type="submit"
                disabled={pending !== null || !open || !(typedMargin > 0)}
                className={PRIMARY}
                data-testid="perp-submit"
              >
                {pending === 'open'
                  ? 'Placing: it fills at the next price…'
                  : `Open ${WAY[direction]}`}
              </button>
            ) : (
              <Link
                href={`/sign-in-test?next=/sandbox/perps/${id}`}
                className={`${PRIMARY} inline-flex items-center justify-center no-underline`}
              >
                Sign in to trade
              </Link>
            )}
            <p className="text-sm text-muted">
              An order fills at the next price published after it was placed, a few seconds later.
              Funding only moves money when both Up and Down are open.
            </p>
            {answer && (
              <p
                role="status"
                data-testid="perp-answer"
                className="rounded-md border border-line bg-note px-4 py-3 break-words"
              >
                {answer.message}
              </p>
            )}
          </form>
        </section>
      </aside>

      <section aria-labelledby="open-positions" className="min-w-0 lg:col-start-1">
        <h2 id="open-positions" className="text-xl font-semibold">
          Your open positions
        </h2>
        {!signedIn ? (
          <p className="mt-2 text-muted">Sign in to see your positions.</p>
        ) : held.length === 0 ? (
          <p className="mt-2 text-muted" data-testid="no-positions">
            None open. Open one with the panel.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="positions">
            {held.map((position) => (
              <li key={position.id} className="py-4" data-testid="position">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="font-medium">
                    {WAY[position.direction]} · {times(position.leverage)} · size{' '}
                    {short(position.size)}
                  </p>
                  <p className="font-semibold tabular-nums" data-testid="position-profit">
                    {position.profit === null ? '–' : signed(position.profit, short)}
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted break-words tabular-nums">
                  Margin {short(position.margin)} · entry {usd(position.entryPrice)} · liquidated at{' '}
                  {usd(position.liquidationPrice)} · worth{' '}
                  {position.value === null ? '–' : short(position.value)}
                </p>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => close(position)}
                  className={`${BUTTON} mt-3`}
                  data-testid="position-close"
                >
                  {pending === position.id ? 'Closing at the next price…' : 'Close'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
