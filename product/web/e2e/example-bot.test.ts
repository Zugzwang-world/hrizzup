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
