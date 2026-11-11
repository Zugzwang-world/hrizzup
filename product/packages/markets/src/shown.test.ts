import type { ListedMarket } from '@hrizzup/api';
import { marketList as exampleList } from '@hrizzup/api/examples';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketQuote, oneMarket } from './data.ts';
import { shownMarket, shownState } from './shown.ts';
import { marketList, positions } from './trading.ts';

/**
 * Quick checks, with no database: a market that is stored as open but past its closing time is shown
 * as closed by every public read (the list, one market, the positions), at the very moment the trade
 * itself starts refusing; a market with time left is shown as open and reported to the read's watcher,
 * which keeps the edge's copy from outliving the closing time. The reads against a real database are
 * in data.db.test.ts; end to end, the market-closes journey.
 */

const NOW = Date.parse('2026-11-11T10:00:00Z');
const at = (secondsFromNow: number) => new Date(NOW + secondsFromNow * 1000).toISOString();

const [first] = exampleList.markets;
if (!first) throw new Error("The API's examples hold no market");
const template: ListedMarket = first;

/** A listed market stored as `state`, closing `closesIn` seconds from now. */
function listed(state: ListedMarket['market']['state'], closesIn: number): ListedMarket {
  return {
    ...template,
    market: { ...template.market, state, closes_at: at(closesIn) },
  } as ListedMarket;
}

/** A pool whose one connection answers every read with `row`. */
function poolAnswering(row: unknown) {
  const client = {
    async query(text: string) {
      return { rows: text.includes(' as answer') ? [{ answer: row }] : [] };
    },
    release() {},
  };
  return { connect: async () => client } as never;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the state a read shows', () => {
  it('is closed for a market stored as open once its closing time has come, never before', () => {
    expect(shownState('open', at(60))).toBe('open');
    expect(shownState('open', at(0.001))).toBe('open');
    // At the closing time itself the books refuse a trade, so it is closed.
    expect(shownState('open', at(0))).toBe('closed');
    expect(shownState('open', at(-1))).toBe('closed');
    expect(shownState('open', at(-86_400))).toBe('closed');
  });

  it('is the stored state for every other market, whatever its closing time', () => {
    for (const state of ['draft', 'closed', 'settled', 'cancelled']) {
      expect(shownState(state, at(-60)), state).toBe(state);
      expect(shownState(state, at(60)), state).toBe(state);
    }
  });

  it('changes only the state of a listed market, and tells the watcher when an open one closes', () => {
    const told: number[] = [];
    const watch = (closesAt: number) => told.push(closesAt);

    const past = listed('open', -5);
    const shown = shownMarket(past, NOW, watch);
    expect(shown.market.state).toBe('closed');
    expect({ ...shown, market: { ...shown.market, state: 'open' } }).toEqual(past);
    expect(told, 'a market already closed is nothing to wait for').toEqual([]);

    const open = listed('open', 90);
    expect(shownMarket(open, NOW, watch)).toBe(open);
    expect(told).toEqual([NOW + 90_000]);

    for (const state of ['draft', 'closed', 'settled', 'cancelled'] as const) {
      const other = listed(state, 90);
      expect(shownMarket(other, NOW, watch), state).toBe(other);
    }
    expect(told, 'only a market shown as open is told of').toEqual([NOW + 90_000]);
  });
});

describe('the public reads', () => {
  it("show the list's open markets as closed once they are past their closing time, and tell the watcher of the rest", async () => {
    const told: number[] = [];
    const pool = poolAnswering({
      markets: [
        listed('open', 600),
        listed('open', -30),
        listed('open', 45),
        listed('settled', -3600),
        listed('closed', -60),
      ],
      next: 'a-cursor',
    });
    const page = await marketList(pool, {}, (closesAt) => told.push(closesAt));
    expect(page.markets.map((item) => item.market.state)).toEqual([
      'open',
      'closed',
      'open',
      'settled',
      'closed',
    ]);
    expect(page.next).toBe('a-cursor');
    expect(told.sort()).toEqual([NOW + 45_000, NOW + 600_000]);
  });

  it('show one market past its closing time as closed, and one with time left as open', async () => {
    const told: number[] = [];
    expect((await oneMarket(poolAnswering(listed('open', -1)), 'id')).market.state).toBe('closed');
    const open = await oneMarket(poolAnswering(listed('open', 30)), 'id', (c) => told.push(c));
    expect(open.market.state).toBe('open');
    expect(told).toEqual([NOW + 30_000]);
  });

  it("show a position's market as closed once it is past its closing time", async () => {
    const row = (state: string, closesIn: number) => ({
      market_id: '019a6b3c-0001-7000-8000-000000000001',
      question: 'Will test event A happen?',
      state,
      closes_at: at(closesIn),
      yes: '1.000000',
      no: '0.000000',
      probability: '0.50000000',
    });
    const page = await positions(
      poolAnswering({
        balance: '100.000000',
        positions: [row('open', 60), row('open', -60), row('settled', -60)],
        next: null,
      }),
      '019a6b3c-0002-7000-8000-000000000002',
    );
    expect(page.positions.map((position) => position.state)).toEqual(['open', 'closed', 'settled']);
  });

  it('tell the watcher when the market a quote is for closes, and refuse a quote once it has', async () => {
    const state = (closesIn: number) => ({
      now: at(0),
      market: {
        id: '019a6b3c-0001-7000-8000-000000000001',
        state: 'open',
        closes_at: at(closesIn),
        p: '0.5',
        pool_yes: '1000',
        pool_no: '1000',
        seed: '1000',
      },
      orders: [],
      balances: {},
    });
    const input = {
      id: '019a6b3c-0001-7000-8000-000000000001',
      action: 'buy',
      outcome: 'yes',
      amount: '10',
    } as const;
    const told: number[] = [];
    const quote = await marketQuote(poolAnswering(state(120)), input, (c) => told.push(c));
    expect(quote.status).toBe('filled');
    expect(told).toEqual([NOW + 120_000]);
    await expect(marketQuote(poolAnswering(state(-1)), input)).rejects.toMatchObject({
      kind: 'refused',
      reason: 'market_closed',
    });
  });
});
