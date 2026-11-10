import { type APIRequestContext, expect } from '@playwright/test';

/**
 * Exact play money for the journeys that trade (journeys/trading-api.spec.ts): amounts as whole
 * millionths of a Ṁ (`bigint`), never floating point, and the check each journey ends with, that
 * its market's books add up to the millionth. It works because every journey's traders are fresh
 * accounts of the run's (support/run.ts) that trade nowhere else, on a market of the run's own:
 * all the money a trader has put into or taken out of the market is their balance's change.
 */

export const micros = (text: string): bigint => {
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  return negative ? -value : value;
};

export const decimal = (value: bigint): string => {
  const negative = value < 0n;
  const size = negative ? -value : value;
  return `${negative ? '-' : ''}${size / 1_000_000n}.${(size % 1_000_000n).toString().padStart(6, '0')}`;
};

export type Answer = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

/** One call of the typed API over HTTP, as any client makes it. */
export async function call(
  as: APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
  data?: unknown,
): Promise<Answer> {
  const response = await as.fetch(path, { method, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  return {
    status: response.status(),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: response.headers(),
  };
}

/** A trader's balance, and their Yes and No shares in one market (none once it's settled). */
export async function holdings(
  trader: APIRequestContext,
  marketId: string,
): Promise<{ balance: bigint; yes: bigint; no: bigint }> {
  const answer = await call(trader, 'GET', '/api/v1/me/positions');
  expect(answer.status, 'positions').toBe(200);
  const positions = answer.body.positions as { marketId: string; yes: string; no: string }[];
  const mine = positions.find((p) => p.marketId === marketId);
  return {
    balance: micros(String(answer.body.balance)),
    yes: micros(mine?.yes ?? '0'),
    no: micros(mine?.no ?? '0'),
  };
}

/** How a market is settled through the console's call, as the console's own form sends it. */
export type Settlement =
  | { outcome: 'yes' | 'no' }
  | { outcome: 'probability'; probability: string }
  | { outcome: 'cancel'; reason: string };

/**
 * What the books pay one person when a market settles (markets.settle, infra/supabase/migrations/
 * *_markets_books.sql): Ṁ1 a winning share; at a set probability, each Yes share its part and each
 * No share the rest, rounded down to the millionth once, in the house's favour; a cancel gives back
 * what the person put in less what they took out, which takes back a sale's profit.
 */
export function payout(
  settlement: Settlement,
  held: { yes: bigint; no: bigint },
  putIn: bigint,
): bigint {
  switch (settlement.outcome) {
    case 'yes':
      return held.yes;
    case 'no':
      return held.no;
    case 'cancel':
      return putIn;
    case 'probability': {
      // The probability has at most 8 places: in hundred-millionths, the product is exact.
      const [whole = '0', fraction = ''] = settlement.probability.split('.');
      const p = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
      return (p * held.yes + (100_000_000n - p) * held.no) / 100_000_000n;
    }
  }
}

/** A trader in one market: their request context, and their balance when they started on it. */
export type Trader = { name: string; as: APIRequestContext; start: bigint };

/**
 * Closes the market and settles it as asked through the console's calls (or, with `settleWith`,
 * however the caller does it, the console's own form in a browser), and checks its books add up,
 * to the millionth:
 * - before it settles, the market holds its seed plus everything its traders put in, less what
 *   they took out (each trader's balance change since `start`);
 * - each trader is paid exactly what the books' rule gives their shares (`payout`), and nothing
 *   else moves on their balance;
 * - the settlement's log line says it paid that much to that many people, and the rest of what the
 *   market held to the house; and the market ends holding nothing.
 * Returns what was paid to each trader.
 */
export async function settleAndCheckBooks(options: {
  admin: APIRequestContext;
  marketId: string;
  traders: Trader[];
  settlement: Settlement;
  evidence: string;
  settleWith?: (heldAtClose: bigint) => Promise<void>;
}): Promise<{ paid: Map<string, bigint>; heldAtClose: bigint }> {
  const { admin, marketId: id, traders, settlement } = options;
  const closed = await call(admin, 'POST', `/api/v1/admin/markets/${id}/close`);
  expect(closed.status, 'closed through the console').toBe(200);
  expect(closed.body.state).toBe('closed');
  const heldAtClose = micros(String(closed.body.held));
  const seed = micros(String(closed.body.seed));

  const before = new Map<string, { balance: bigint; yes: bigint; no: bigint }>();
  for (const trader of traders) before.set(trader.name, await holdings(trader.as, id));
  const putIn = (trader: Trader) => trader.start - (before.get(trader.name)?.balance ?? 0n);
  const net = traders.reduce((sum, trader) => sum + putIn(trader), 0n);
  expect(
    decimal(heldAtClose),
    'the market holds its seed and what its traders put in, less what they took out',
  ).toBe(decimal(seed + net));

  if (options.settleWith) await options.settleWith(heldAtClose);
  else {
    const settled = await call(admin, 'POST', `/api/v1/admin/markets/${id}/settle`, {
      id,
      ...settlement,
      evidence: options.evidence,
    });
    expect(settled.status, `settled ${settlement.outcome} through the console`).toBe(200);
  }

  const paid = new Map<string, bigint>();
  for (const trader of traders) {
    const was = before.get(trader.name) ?? { balance: 0n, yes: 0n, no: 0n };
    const owed = payout(settlement, was, putIn(trader));
    paid.set(trader.name, owed);
    const now = await holdings(trader.as, id);
    expect(decimal(now.balance), `${trader.name} is paid exactly what the books' rule gives`).toBe(
      decimal(was.balance + owed),
    );
    expect(
      now.yes === 0n && now.no === 0n,
      `${trader.name}'s position leaves with the market`,
    ).toBe(true);
  }
  const view = await call(admin, 'GET', `/api/v1/admin/markets/${id}`);
  const expectedState = settlement.outcome === 'cancel' ? 'cancelled' : 'settled';
  expect(view.body).toMatchObject({ state: expectedState, held: '0.000000', listed: false });
  const log = (view.body.log as { action: string; settlement: Record<string, unknown> | null }[])
    .filter((line) => line.action === 'settle')
    .at(-1)?.settlement;
  const toPeople = [...paid.values()].reduce((sum, value) => sum + value, 0n);
  expect(log, "the settlement's log line").toMatchObject({
    outcome: settlement.outcome,
    paidToPeople: decimal(toPeople),
    people: [...paid.values()].filter((value) => value !== 0n).length,
    toHouse: decimal(heldAtClose - toPeople),
  });
  return { paid, heldAtClose };
}
