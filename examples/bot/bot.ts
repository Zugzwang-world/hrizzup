/**
 * Hrizzup's example bot (PLAN.md step 3.5d): a walk through the public API with a trading key, on
 * staging, the demo (play money only). It reads a market and the Bitcoin perp, gets a quote, places a
 * limit order and cancels it, buys and sells, opens a perp position and closes it in two halves (only
 * when the account holds no position on that perp: it never trades yours), then prints its
 * portfolio. Plain TypeScript and the standard `fetch`, nothing to install:
 *
 *   export HRIZZUP_API_KEY=hz_demo_...      # a trading key from the sandbox's keys page, never in code
 *   node examples/bot/bot.ts
 *
 * Optional: HRIZZUP_API_URL (staging's API by default), HRIZZUP_MARKET (a market's ID; the newest open
 * market by default, skipping any that is closed, past its closing time or about to close) and
 * HRIZZUP_PERP (a perp's ID; the Bitcoin perp by default). The key is read from
 * the environment and never printed. Every trade carries a new request ID, so a retry never trades
 * twice. The docs: https://staging.hrizzup.com/docs
 */

import { pathToFileURL } from 'node:url';

const STAGING = 'https://staging.hrizzup.com/api/v1';

/** What the bot needs: its key, and optionally where to find the API, a market and a perp. */
export type Options = {
  key: string;
  api?: string;
  market?: string;
  perp?: string;
  /** How to make a request (the standard `fetch` unless given). */
  fetch?: typeof fetch;
  /** Where each line of the walk goes (the terminal unless given). */
  log?: (line: string) => void;
  /** The time now, in milliseconds (the clock unless given). */
  now?: () => number;
};

type Json = Record<string, unknown>;

/** A refusal from the API, in its one format: `{ code, status, message, data }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Json;
  constructor(status: number, body: Json) {
    super(`${status} ${String(body.code ?? '')}: ${String(body.message ?? 'refused')}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * How long a market must stay open, in milliseconds, for the bot to pick it: a trade is refused from a
 * market's closing time on, and the walk's market trades take a few seconds, so one about to close is
 * skipped rather than picked and refused halfway.
 */
export const MIN_OPEN_MS = 60_000;

/** Whether a market from the list is open now and stays open long enough for the walk. */
export function staysOpen(
  market: { state: string; closes_at: string },
  now: number = Date.now(),
): boolean {
  return market.state === 'open' && Date.parse(market.closes_at) - now >= MIN_OPEN_MS;
}

/** Half of an amount written as exact decimal text (to the millionth), rounded down. */
function half(amount: string): string {
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const micros = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6))) / 2n;
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, '0')}`;
}

/** Runs the walk, logging each step, and gives back every answer it got. */
export async function runBot(options: Options) {
  const api = (options.api ?? STAGING).replace(/\/$/, '');
  const send = options.fetch ?? fetch;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;

  /** One call. Public reads go without the key, so the edge's copy can answer them. */
  async function call(method: 'GET' | 'POST', path: string, body?: Json, withKey = true) {
    const headers: Record<string, string> = {};
    if (withKey) headers.authorization = `Bearer ${options.key}`;
    if (body) headers['content-type'] = 'application/json';
    const response = await send(`${api}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer = (await response.json()) as Json;
    if (!response.ok) throw new ApiError(response.status, answer);
    return answer;
  }
  const read = (path: string) => call('GET', path, undefined, false);
  const newRequest = () => crypto.randomUUID();

  // 1. Who the key belongs to.
  const me = await call('GET', '/me');
  log(`Signed in with an API key as account ${me.id}.`);

  // 2. A market and the perp.
  let marketId = options.market;
  if (!marketId) {
    // The newest market that is open and stays open: one that is closed, or past its closing time
    // whatever its state says, or about to close, would refuse the bot's first trade.
    const listed = await read('/markets?limit=50');
    const open = (
      listed.markets as { market: { id: string; state: string; closes_at: string } }[]
    ).find((item) => staysOpen(item.market, now()));
    if (!open) throw new Error('No open market to trade: set HRIZZUP_MARKET');
    marketId = open.market.id;
  }
  const market = await read(`/markets/${marketId}`);
  const question = (market.market as { question: string }).question;
  log(`Market: "${question}", Yes at ${market.probability}.`);
  let perpId = options.perp;
  if (!perpId) {
    const perps = await read('/perps');
    perpId = (perps.perps as { id: string }[])[0]?.id;
    if (!perpId) throw new Error('No perp to trade: set HRIZZUP_PERP');
  }
  const perp = await read(`/perps/${perpId}`);
  log(`Perp: ${perp.name}, at ${perp.price}.`);

  // 3. A quote for Ṁ10 of Yes: what the trade would do, writing nothing.
  const quote = await read(`/markets/${marketId}/quote?outcome=yes&amount=10`);
  log(
    `Quote: Ṁ10 of Yes gets ${quote.shares} shares at ${quote.averagePrice} on average, ` +
      `taking Yes from ${quote.probBefore} to ${quote.probAfter}.`,
  );

  // 4. A limit order well below the price, which rests; then cancelled.
  const limitProb = Math.max(0.01, Number(market.probability) - 0.2).toFixed(2);
  const order = await call('POST', '/trades', {
    marketId,
    requestId: newRequest(),
    action: 'buy',
    outcome: 'yes',
    amount: '5',
    limitProb,
  });
  log(`Limit order: Ṁ5 of Yes at ${limitProb} or lower, ${order.status}.`);
  const cancelled = await call('POST', '/orders/cancel', {
    marketId,
    orderId: order.tradeId,
    requestId: newRequest(),
  });
  log(`Cancelled it: ${cancelled.status}.`);

  // 5. The trade the quote was for: it fills exactly as quoted unless someone traded in between.
  const bought = await call('POST', '/trades', {
    marketId,
    requestId: newRequest(),
    action: 'buy',
    outcome: 'yes',
    amount: '10',
  });
  const asQuoted = bought.shares === quote.shares && bought.probAfter === quote.probAfter;
  log(
    `Bought: Ṁ${bought.amount} for ${bought.shares} Yes shares, Yes now ${bought.probAfter} ` +
      `(${asQuoted ? 'exactly as quoted' : 'the market moved since the quote'}).`,
  );

  // 6. Selling half of those shares.
  const sold = await call('POST', '/trades', {
    marketId,
    requestId: newRequest(),
    action: 'sell',
    outcome: 'yes',
    shares: half(String(bought.shares)),
  });
  log(`Sold ${half(String(bought.shares))} shares for Ṁ${String(sold.amount).replace('-', '')}.`);

  // 7. The perp: a quote, then a 2-times long with Ṁ10, closed in two halves. Each order fills at the
  //    next price, a few seconds on, so each call answers within seconds. An account holds one
  //    position per side on a perp: opening adds to it (or, on the other side, closes it first), and
  //    closing takes from it. So the bot trades the perp only when it holds nothing there, and closes
  //    only what it opened: never a position of yours.
  const perpQuote = await read(`/perps/${perpId}/quote?direction=long&margin=10&leverage=2`);
  log(
    `Perp quote: Ṁ10 at 2 times is a Ṁ${perpQuote.size} position, fee Ṁ${perpQuote.fee}, ` +
      `liquidated at ${perpQuote.liquidationPrice} (at today's ${perpQuote.price}).`,
  );
  const before = await call('GET', '/me/perps');
  const held = (before.positions as { perpId: string; direction: string; size: string }[]).find(
    (position) => position.perpId === perpId,
  );
  let opened: Json | null = null;
  let closedHalf: Json | null = null;
  let closed: Json | null = null;
  if (held) {
    log(
      `You hold a ${held.direction} of ${held.size} on this perp already. An account holds one ` +
        'position per side, so the bot would trade yours: it leaves the perp alone.',
    );
  } else {
    opened = await call('POST', '/perps/open', {
      perpId,
      requestId: newRequest(),
      direction: 'long',
      margin: '10',
      leverage: '2',
    });
    const position = opened.position as { size: string };
    log(`Opened a long of ${position.size} at ${opened.price}, fee Ṁ${opened.fee}.`);
    if (opened.status !== 'opened') {
      // Someone opened on this perp in the meantime, so the bot's open was added to theirs.
      log("A position of yours appeared as the bot opened, so it closes nothing: it isn't all the bot's.");
    } else {
      closedHalf = await call('POST', '/perps/close', {
        perpId,
        requestId: newRequest(),
        fraction: '0.5',
        expectedSize: position.size,
      });
      log(`Closed half at ${closedHalf.price}: Ṁ${closedHalf.payout} back.`);
      const left = closedHalf.position as { size: string } | null;
      if (left) {
        // The rest, sized on what's left of the bot's own, so nothing else is taken.
        closed = await call('POST', '/perps/close', {
          perpId,
          requestId: newRequest(),
          fraction: '1',
          expectedSize: left.size,
        });
        log(`Closed the rest at ${closed.price}: Ṁ${closed.payout} back.`);
      }
    }
  }

  // 8. The portfolio.
  const positions = await call('GET', '/me/positions');
  const orders = await call('GET', '/me/orders');
  const perps = await call('GET', '/me/perps');
  const trades = await call('GET', '/me/trades?limit=10');
  log(
    `Portfolio: balance Ṁ${positions.balance}, ${(positions.positions as unknown[]).length} market ` +
      `positions, ${(orders.orders as unknown[]).length} resting orders, ` +
      `${(perps.positions as unknown[]).length} perp positions, ` +
      `${(trades.trades as unknown[]).length} latest trades.`,
  );

  return {
    marketId,
    perpId,
    quote,
    order,
    cancelled,
    bought,
    sold,
    perpQuote,
    opened,
    closedHalf,
    closed,
    positions,
    orders,
    perps,
    trades,
  };
}

// Run from the command line: the key from the environment, never from the code.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.HRIZZUP_API_KEY;
  if (!key) {
    console.error('Set HRIZZUP_API_KEY to a trading key from the sandbox keys page first.');
    process.exit(1);
  }
  try {
    await runBot({
      key,
      ...(process.env.HRIZZUP_API_URL ? { api: process.env.HRIZZUP_API_URL } : {}),
      ...(process.env.HRIZZUP_MARKET ? { market: process.env.HRIZZUP_MARKET } : {}),
      ...(process.env.HRIZZUP_PERP ? { perp: process.env.HRIZZUP_PERP } : {}),
    });
    console.log('Done.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
