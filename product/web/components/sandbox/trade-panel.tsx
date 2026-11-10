'use client';

import Link from 'next/link';
import { useState } from 'react';
import { tradeAction } from '@/app/sandbox/actions.ts';
import { FIELD } from '@/components/console/controls.tsx';
import { noCents, plain, shareOf, typedAmount, yesCents } from '@/lib/sandbox/format.ts';
import { Choice, PRIMARY, QuickAmount } from './ui.tsx';

type Side = 'yes' | 'no';

/**
 * Kalshi's trade panel for one market: buy or sell, Yes or No, at market or with a limit, an amount
 * of play money (or, to sell, the shares to sell), and what the books answered. A limit order rests
 * until a later trade reaches its price; it is cancelled from the list under the chart.
 */
export function TradePanel({
  marketId,
  open,
  signedIn,
  chanceNow,
  balance,
  position,
}: {
  marketId: string;
  open: boolean;
  signedIn: boolean;
  /** The probability of Yes now, exact text, or null once the market has finished. */
  chanceNow: string | null;
  balance: string | null;
  position: { yes: string; no: string } | null;
}) {
  const [action, setAction] = useState<'buy' | 'sell'>('buy');
  const [outcome, setOutcome] = useState<Side>('yes');
  const [kind, setKind] = useState<'market' | 'limit'>('market');
  const [amount, setAmount] = useState('');
  const [sold, setSold] = useState('');
  const [limit, setLimit] = useState('');
  const [expires, setExpires] = useState<'never' | 'hour' | 'day'>('never');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);

  const held = position?.[outcome] ?? '0';
  const selling = action === 'sell';
  const field = selling ? sold : amount;
  const ready =
    Number(typedAmount(field)) > 0 && (selling || kind === 'market' || limit.trim() !== '');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setAnswer(null);
    try {
      const result = await tradeAction({
        marketId,
        // A fresh ID for each press: pressing again is a new order, never a retry of the last.
        requestId: crypto.randomUUID(),
        action,
        outcome,
        amount,
        shares: sold,
        limit: !selling && kind === 'limit' ? limit : '',
        expires,
      });
      setAnswer(result);
      if (result.ok) {
        setAmount('');
        setSold('');
      }
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <section aria-labelledby="trade-heading" className="rounded-lg border border-line p-5">
        <h2 id="trade-heading" className="text-xl font-semibold">
          Trade
        </h2>
        <p className="mt-3 text-muted">This market isn't open for trading.</p>
      </section>
    );
  }

  return (
    <section aria-label="Trade" className="rounded-lg border border-line p-5">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4" data-testid="trade-form">
        <Choice
          label="Buy or sell"
          value={action}
          onChange={(next) => {
            setAction(next);
            setAnswer(null);
          }}
          options={[
            { value: 'buy', text: 'Buy' },
            { value: 'sell', text: 'Sell' },
          ]}
          testId="trade-action"
        />
        <Choice
          label="Yes or No"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'yes', text: chanceNow ? `Yes ${yesCents(chanceNow)}¢` : 'Yes' },
            { value: 'no', text: chanceNow ? `No ${noCents(chanceNow)}¢` : 'No' },
          ]}
          testId="trade-outcome"
        />

        {!selling && (
          <div>
            <label htmlFor="trade-kind" className="font-medium">
              Order
            </label>
            <select
              id="trade-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'market' | 'limit')}
              className={FIELD}
            >
              <option value="market">Market: buy now</option>
              <option value="limit">Limit: wait for a price</option>
            </select>
          </div>
        )}

        <div>
          <label htmlFor="trade-amount" className="font-medium">
            {selling
              ? `Shares to sell (you hold ${plain(held)} ${outcome === 'yes' ? 'Yes' : 'No'})`
              : 'Amount (Ṁ)'}
          </label>
          <input
            id="trade-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={field}
            onChange={(event) => (selling ? setSold : setAmount)(event.target.value)}
            className={`${FIELD} tabular-nums`}
          />
          {(selling ? position : balance !== null) && (
            <div className="mt-2 flex gap-2">
              {[25, 50].map((percent) => (
                <QuickAmount
                  key={percent}
                  onClick={() =>
                    (selling ? setSold : setAmount)(
                      shareOf(selling ? held : (balance ?? '0'), percent),
                    )
                  }
                >
                  {percent}%
                </QuickAmount>
              ))}
              <QuickAmount onClick={() => (selling ? setSold(held) : setAmount(balance ?? ''))}>
                Max
              </QuickAmount>
            </div>
          )}
        </div>

        {!selling && kind === 'limit' && (
          <>
            <div>
              <label htmlFor="trade-limit" className="font-medium">
                Limit: chance of Yes (%)
              </label>
              <p id="trade-limit-hint" className="text-sm text-muted">
                {outcome === 'yes'
                  ? 'Buys Yes only while the chance is at most this.'
                  : 'Buys No only while the chance of Yes is at least this.'}
              </p>
              <input
                id="trade-limit"
                inputMode="decimal"
                autoComplete="off"
                placeholder="45"
                value={limit}
                aria-describedby="trade-limit-hint"
                onChange={(event) => setLimit(event.target.value)}
                className={`${FIELD} tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="trade-expires" className="font-medium">
                Rests for
              </label>
              <select
                id="trade-expires"
                value={expires}
                onChange={(event) => setExpires(event.target.value as 'never' | 'hour' | 'day')}
                className={FIELD}
              >
                <option value="never">Until filled or cancelled</option>
                <option value="hour">1 hour</option>
                <option value="day">1 day</option>
              </select>
            </div>
          </>
        )}

        {signedIn ? (
          <button
            type="submit"
            disabled={pending || !ready}
            className={PRIMARY}
            data-testid="trade-submit"
          >
            {pending
              ? 'Placing…'
              : `${selling ? 'Sell' : 'Buy'} ${outcome === 'yes' ? 'Yes' : 'No'}${!selling && kind === 'limit' ? ' with a limit' : ''}`}
          </button>
        ) : (
          <Link
            href={`/sign-in-test?next=/sandbox/markets/${marketId}`}
            className={`${PRIMARY} inline-flex items-center justify-center no-underline`}
          >
            Sign in to trade
          </Link>
        )}

        {answer && (
          <p
            role="status"
            data-testid="trade-answer"
            className="rounded-md border border-line bg-note px-4 py-3 break-words"
          >
            {answer.message}
          </p>
        )}
      </form>
    </section>
  );
}
