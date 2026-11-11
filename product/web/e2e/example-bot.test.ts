import { describe, expect, it } from 'vitest';
import { MIN_OPEN_MS, runBot, staysOpen } from '../../../examples/bot/bot.ts';

/**
 * Quick checks, with no network: which market the example bot picks when it's not told one. The
 * founder's own run on 11 November 2026 picked the "closes within a day" test market after it closed,
 * because the list still called it open; a closed market, one past its closing time whatever its
 * state says, and one about to close are all skipped. The walk itself is the journey's
 * (journeys/example-bot.spec.ts) and the done-test's.
 */

const NOW = Date.parse('2026-11-11T10:00:00Z');
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

describe('a market the bot may pick', () => {
  it('is open and stays open long enough for the walk', () => {
    expect(staysOpen({ state: 'open', closes_at: at(3600) }, NOW)).toBe(true);
    expect(staysOpen({ state: 'open', closes_at: at(MIN_OPEN_MS / 1000) }, NOW)).toBe(true);
  });

  it("isn't one that is closed, past its closing time whatever its state says, or about to close", () => {
    expect(staysOpen({ state: 'open', closes_at: at(MIN_OPEN_MS / 1000 - 1) }, NOW)).toBe(false);
    expect(staysOpen({ state: 'open', closes_at: at(0) }, NOW)).toBe(false);
    expect(staysOpen({ state: 'open', closes_at: at(-3 * 3600) }, NOW)).toBe(false);
    for (const state of ['draft', 'closed', 'settled', 'cancelled']) {
      expect(staysOpen({ state, closes_at: at(3600) }, NOW), state).toBe(false);
    }
  });
});

/** The API as far as the bot's market pick: it answers `/me` and the list, and stops at the pick. */
function apiListing(markets: { id: string; state: string; closes_at: string }[]) {
  const asked: string[] = [];
  const fetchStub: typeof fetch = async (input) => {
    const path = String(input).replace('https://staging.hrizzup.com/api/v1', '');
    asked.push(path);
    const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '/me') return answer({ id: 'an-account' });
    if (path.startsWith('/markets?')) {
      return answer({ markets: markets.map((market) => ({ market, probability: '0.5' })) });
    }
    // The pick is made: asking for that market's own page is as far as these checks go.
    throw new Error(`picked ${path}`);
  };
  return { asked, fetchStub };
}

describe('the bot with no market named', () => {
  const closedAlready = { id: 'closed-already', state: 'closed', closes_at: at(-7200) };
  // What the founder's run found: the list still said open, after the closing time.
  const stalePastClose = { id: 'stale-past-close', state: 'open', closes_at: at(-3600) };
  const aboutToClose = { id: 'about-to-close', state: 'open', closes_at: at(20) };
  const trading = { id: 'trading', state: 'open', closes_at: at(86_400) };
  const older = { id: 'older', state: 'open', closes_at: at(7 * 86_400) };

  it('skips every market that is closed, past its closing time or about to close, and takes the newest that is left', async () => {
    const { asked, fetchStub } = apiListing([
      closedAlready,
      stalePastClose,
      aboutToClose,
      trading,
      older,
    ]);
    await expect(
      runBot({ key: 'a-key', fetch: fetchStub, log: () => {}, now: () => NOW }),
    ).rejects.toThrow('picked /markets/trading');
    expect(asked.filter((path) => path.startsWith('/markets/'))).toEqual(['/markets/trading']);
  });

  it('stops, saying so, when no market is left to trade', async () => {
    const { fetchStub } = apiListing([closedAlready, stalePastClose, aboutToClose]);
    await expect(
      runBot({ key: 'a-key', fetch: fetchStub, log: () => {}, now: () => NOW }),
    ).rejects.toThrow('No open market to trade: set HRIZZUP_MARKET');
  });
});

/**
 * The API as far as the whole walk, for the perp's part: an account holds one position per side on a
 * perp, so the bot must never trade one of the person's own. Every call is recorded.
 */
function apiWalking(options: { held?: { direction: string; size: string }; openStatus?: string }) {
  const sent: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let size = '0';
  const fetchStub: typeof fetch = async (input, init) => {
    const path = String(input).replace('https://staging.hrizzup.com/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    sent.push({ method, path, ...(body ? { body } : {}) });
    const answer = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (path === '/me') return answer({ id: 'an-account' });
    if (path === '/markets/m') {
      return answer({
        market: { question: 'Q?', state: 'open', closes_at: at(86_400) },
        probability: '0.5',
      });
    }
    if (path === '/perps/p') return answer({ name: 'Bitcoin', price: '100' });
    if (path.startsWith('/markets/m/quote')) {
      return answer({ shares: '19', averagePrice: '0.52', probBefore: '0.5', probAfter: '0.55' });
    }
    if (path === '/trades' && body?.limitProb) return answer({ status: 'resting', tradeId: 'o1' });
    if (path === '/orders/cancel') return answer({ status: 'cancelled' });
    if (path === '/trades' && body?.action === 'buy') {
      return answer({ amount: '10', shares: '19', probAfter: '0.55', tradeId: 't1' });
    }
    if (path === '/trades') return answer({ amount: '-4.9', shares: '-9.5', tradeId: 't2' });
    if (path.startsWith('/perps/p/quote')) {
      return answer({ size: '20', fee: '0.02', liquidationPrice: '50', price: '100' });
    }
    if (path === '/me/perps') {
      const positions =
        options.held && sent.filter((one) => one.path === '/me/perps').length === 1
          ? [{ perpId: 'p', ...options.held }]
          : [];
      return answer({ balance: '1000', positions });
    }
    if (path === '/perps/open') {
      size = '20';
      return answer({
        status: options.openStatus ?? 'opened',
        price: '100',
        fee: '0.02',
        margin: '10',
        position: { size },
      });
    }
    if (path === '/perps/close') {
      const fraction = Number(body?.fraction);
      size = fraction >= 1 ? '0' : '10';
      return answer({ price: '101', payout: '5', position: size === '0' ? null : { size } });
    }
    if (path === '/me/positions') return answer({ balance: '1000', positions: [] });
    if (path === '/me/orders') return answer({ orders: [] });
    if (path.startsWith('/me/trades')) return answer({ trades: [] });
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { sent, fetchStub };
}

describe("the bot and the account's own perp position", () => {
  const walk = (stub: ReturnType<typeof apiWalking>) => {
    const lines: string[] = [];
    return {
      lines,
      run: runBot({
        key: 'a-key',
        market: 'm',
        perp: 'p',
        fetch: stub.fetchStub,
        log: (line) => lines.push(line),
        now: () => NOW,
      }),
    };
  };
  const perpCalls = (sent: { method: string; path: string }[]) =>
    sent.filter((one) => one.method === 'POST' && one.path.startsWith('/perps/'));

  it('leaves the perp alone when the account already holds a position there, saying why', async () => {
    const stub = apiWalking({ held: { direction: 'long', size: '5000' } });
    const { lines, run } = walk(stub);
    const ran = await run;
    expect(perpCalls(stub.sent)).toEqual([]);
    expect(ran.opened).toBeNull();
    expect(lines.join('\n')).toContain('You hold a long of 5000 on this perp already');
  });

  it('with nothing held, opens and closes exactly what it opened: half, then the rest, each sized on its own', async () => {
    const stub = apiWalking({});
    await walk(stub).run;
    expect(perpCalls(stub.sent).map((one) => [one.path, (one as { body?: object }).body])).toEqual([
      ['/perps/open', expect.objectContaining({ direction: 'long', margin: '10', leverage: '2' })],
      ['/perps/close', expect.objectContaining({ fraction: '0.5', expectedSize: '20' })],
      ['/perps/close', expect.objectContaining({ fraction: '1', expectedSize: '10' })],
    ]);
  });

  it("closes nothing when its open was added to a position that appeared meanwhile: it isn't all the bot's", async () => {
    const stub = apiWalking({ openStatus: 'added' });
    const { lines, run } = walk(stub);
    const ran = await run;
    expect(perpCalls(stub.sent).map((one) => one.path)).toEqual(['/perps/open']);
    expect(ran.closedHalf).toBeNull();
    expect(lines.join('\n')).toContain('closes nothing');
  });
});
