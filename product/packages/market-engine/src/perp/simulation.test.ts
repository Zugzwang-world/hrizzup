import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS, HOUR_MS } from '../manifold/util/time.ts';
import {
  applyPerpFunding,
  applyPerpPrice,
  closePerpPosition,
  newPerpBook,
  openPerpPosition,
  type PerpBook,
  type PerpRefusal,
} from './engine.ts';
import { PERP_SETTINGS, type PerpSettings } from './settings.ts';
import { STAND_IN_PRICE, standInPrice } from './stand-in-price.ts';
import { HOUSE, TestLedger } from './test-ledger.ts';

// The long simulation (README, "Our money tests: the perp"): many traders opening, adding,
// flipping and closing the perp over simulated weeks of the stand-in price, a new price every
// 5 seconds, with liquidations, winners scaled down and hourly funding happening by themselves.
// The ledger checks every step: no play money created or lost, the pools holding exactly the
// perp's money, nobody below zero, every winner payable. Seeded, so every run is the same run.
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => {
    throw new Error('the perps maths read the clock');
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A small seeded random source for the traders (Tommy Ettinger's Mulberry32, public domain). */
const randomSource = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
};

type Order =
  | { kind: 'open'; userId: string; direction: 'long' | 'short'; margin: number; leverage: number }
  | { kind: 'close'; userId: string; direction: 'long' | 'short'; fraction: number; size: number };

const simulate = (args: {
  priceSeed: string;
  tradeSeed: number;
  days: number;
  traders: number;
  settings: PerpSettings;
  /** Six hours closing-only, then an hour halted (day 10), and five minutes without prices (day 12). */
  incidents?: boolean;
}) => {
  const { settings } = args;
  const random = randomSource(args.tradeSeed);
  const start = STAND_IN_PRICE.origin + 40 * DAY_MS;
  const first = standInPrice(args.priceSeed, start);
  let book: PerpBook = newPerpBook({
    contractId: 'perp-btc',
    feedId: STAND_IN_PRICE.feedId,
    settings,
    price: first.price,
    priceTime: first.ts,
    now: first.ts,
  });
  const traders = Array.from({ length: args.traders }, (_, i) => `trader-${i}`);
  // Each trader's own patience: the chance they close when they act. Some hold for days.
  // Half of them are holders, who sit on a position for days. Adding and flipping come in
  // proportion: a holder who kept adding at the latest price would drag their entry along.
  const patience = new Map(
    traders.map((id, i) => [id, i % 2 === 0 ? 0.004 : 0.02 + 0.5 * random()]),
  );
  // And their own taste in leverage, from careful to the most allowed.
  // (Taken across the holders too: trader i's taste is the (i ÷ 2)th, so every kind holds.)
  const taste = new Map(
    traders.map((id, i) => [id, [2, 3, 5, 8, 10][Math.floor(i / 2) % 5] as number]),
  );
  const ledger = new TestLedger(
    Object.fromEntries(traders.map((id) => [id, 2_000])),
    settings.subsidyLong + settings.subsidyShort,
  );
  ledger.check(book, 'opened');

  const counts = {
    steps: 0,
    opens: 0,
    closes: 0,
    flips: 0,
    liquidations: 0,
    scaledDown: 0,
    settledByScaling: 0,
    fundings: 0,
    fundingPaidByLongs: 0,
    fundingPaidByShorts: 0,
    pausedPrices: 0,
    missedPrices: 0,
    fundingSkippedStale: 0,
    refused: {} as Partial<Record<PerpRefusal['code'], number>>,
  };
  const refused = (code: PerpRefusal['code']) => {
    counts.refused[code] = (counts.refused[code] ?? 0) + 1;
  };

  // Orders wait for the next price: each is placed between two prices and fills at the second.
  let waiting: { order: Order; placedTime: number }[] = [];
  const ticks = (args.days * DAY_MS) / STAND_IN_PRICE.intervalMs;
  for (let tick = 1; tick <= ticks; tick++) {
    const point = standInPrice(args.priceSeed, start + tick * STAND_IN_PRICE.intervalMs);
    const elapsed = point.ts - start;
    const offSwitch =
      args.incidents && elapsed >= 10 * DAY_MS && elapsed < 10 * DAY_MS + 7 * HOUR_MS;
    const tradingMode =
      offSwitch && elapsed < 10 * DAY_MS + 6 * HOUR_MS
        ? 'reduce-only'
        : offSwitch
          ? 'halted'
          : 'enabled';
    // No price for five minutes across an hour (the price job down): orders wait, funding finds
    // the price too old and skips that hour.
    const gap = 12 * DAY_MS + 57 * 60_000;
    if (args.incidents && elapsed >= gap && elapsed < gap + 5 * 60_000) {
      counts.missedPrices++;
      const skipped =
        elapsed % HOUR_MS === 0 ? applyPerpFunding({ book, settings, now: point.ts }) : null;
      if (skipped && !skipped.ok && skipped.reason === 'stale_price') counts.fundingSkippedStale++;
      if (skipped?.ok) throw new Error('funding ran on a price over 2 minutes old');
      continue;
    }
    const priced = applyPerpPrice({ book, price: point.price, priceTime: point.ts });
    book = priced.book;
    ledger.apply(priced.moves);
    counts.steps++;
    counts.liquidations += priced.liquidated.length;
    if (priced.adlFactorLong < 1 || priced.adlFactorShort < 1) counts.scaledDown++;
    counts.settledByScaling += priced.moves.length;
    if (book.halt !== null) counts.pausedPrices++;
    ledger.check(book, () => `price at tick ${tick}`);

    for (const { order, placedTime } of waiting) {
      const now = point.ts;
      if (order.kind === 'open') {
        const flipping = book.state.positions.some(
          (p) => p.userId === order.userId && p.direction !== order.direction,
        );
        const result = openPerpPosition({
          book,
          settings,
          tradingMode,
          request: { ...order, placedTime },
          balance: ledger.balance(order.userId),
          now,
        });
        if (!result.ok) refused(result.refusal.code);
        else {
          book = result.book;
          ledger.apply(result.moves);
          counts.opens++;
          if (flipping) counts.flips++;
        }
      } else {
        const result = closePerpPosition({
          book,
          settings,
          tradingMode,
          request: {
            userId: order.userId,
            direction: order.direction,
            fraction: order.fraction,
            expectedSize: order.size,
            placedTime,
          },
          now,
        });
        if (!result.ok) refused(result.refusal.code);
        else {
          book = result.book;
          ledger.apply(result.moves);
          counts.closes++;
        }
      }
      counts.steps++;
      ledger.check(book, () => `${order.kind} by ${order.userId} at tick ${tick}`);
    }
    waiting = [];

    // Funding runs from an hourly job, on the hour, as Manifold's does. (Asked every 5 seconds
    // instead, it would run every 59 minutes: Manifold lets a run come up to a minute early, to
    // absorb a late scheduler.)
    const funded =
      (point.ts - start) % HOUR_MS === 0
        ? applyPerpFunding({ book, settings, now: point.ts })
        : ({ ok: false, reason: 'not_due' } as const);
    if (funded.ok) {
      book = funded.book;
      ledger.apply(funded.moves);
      counts.fundings++;
      counts.settledByScaling += funded.moves.length;
      if (funded.fundingRate > 0) counts.fundingPaidByLongs++;
      if (funded.fundingRate < 0) counts.fundingPaidByShorts++;
      counts.steps++;
      ledger.check(book, () => `funding at tick ${tick}`);
    }

    // About one order a minute across everyone, placed somewhere in the next 5 seconds.
    if (random() < 1 / 12) {
      const userId = traders[Math.floor(random() * traders.length)] as string;
      const held = book.state.positions.find((p) => p.userId === userId);
      const placedTime = point.ts + 1 + Math.floor(random() * 4_998);
      const roll = random();
      const openOrder = (direction: 'long' | 'short'): Order => ({
        kind: 'open',
        userId,
        direction,
        margin: Math.max(1, Math.round(ledger.balance(userId) * (0.05 + 0.4 * random()))),
        // Mostly within the cap, now and then past it, to be refused.
        leverage: random() < 0.03 ? 10 + Math.ceil(random() * 10) : (taste.get(userId) as number),
      });
      let order: Order;
      if (!held) order = openOrder(random() < 0.5 ? 'long' : 'short');
      else if (roll < (patience.get(userId) as number))
        order = {
          kind: 'close',
          userId,
          direction: held.direction,
          fraction: random() < 0.6 ? 1 : 0.1 + 0.8 * random(),
          size: held.size,
        };
      else if (roll < 1.5 * (patience.get(userId) as number)) order = openOrder(held.direction);
      else if (roll < 1.8 * (patience.get(userId) as number))
        order = openOrder(held.direction === 'long' ? 'short' : 'long');
      else continue;
      waiting.push({ order, placedTime });
    }
  }

  // At the end, everyone closes at the last price: what's left in the pools is the house's.
  for (const p of [...book.state.positions]) {
    const result = closePerpPosition({
      book,
      settings,
      tradingMode: 'enabled',
      request: {
        userId: p.userId,
        direction: p.direction,
        fraction: 1,
        placedTime: book.priceTime - 1,
      },
      now: book.priceTime,
    });
    if (!result.ok) throw new Error(`the final close was refused: ${result.refusal.message}`);
    book = result.book;
    ledger.apply(result.moves);
    ledger.check(book, `final close by ${p.userId}`);
  }
  return { book, ledger, counts };
};

describe('the long simulation', () => {
  it('keeps every Ṁ through three weeks of trading on the stand-in price', {
    timeout: 120_000,
  }, () => {
    const { book, ledger, counts } = simulate({
      priceSeed: '5eed5eed5eed5eed',
      tradeSeed: 2026,
      days: 21,
      traders: 30,
      settings: PERP_SETTINGS,
      incidents: true,
    });
    // It really traded, and everything the perp does happened.
    // (The runs are seeded, so these are what this run does: 3,750 opens, 2,769 closes, 782 flips,
    // 3 liquidations, 503 fundings, 108 orders refused for leverage, 110 by the off switch.)
    expect(counts.opens).toBeGreaterThan(3_000);
    expect(counts.closes).toBeGreaterThan(2_000);
    expect(counts.flips).toBeGreaterThan(500);
    expect(counts.liquidations).toBeGreaterThan(0);
    expect(counts.fundings).toBe(21 * 24 - 1); // every hour but the one without a fresh price
    expect(counts.fundingSkippedStale).toBe(1);
    expect(counts.missedPrices).toBe(60);
    // The off switch: closing-only refused opens, halted refused closes too.
    expect(counts.refused.trading_off).toBeGreaterThan(0);
    expect(counts.fundingPaidByLongs).toBeGreaterThan(0);
    expect(counts.fundingPaidByShorts).toBeGreaterThan(0);
    expect(counts.refused.leverage_too_high).toBeGreaterThan(0);
    // Every check passed at every step (or the run would have stopped); at the end, with no
    // positions left, the perp holds exactly its pools, and everyone's money adds up.
    expect(book.state.positions).toEqual([]);
    expect(ledger.escrow).toBeCloseTo(book.state.pool.L + book.state.pool.S, 6);
    expect(ledger.total()).toBeCloseTo(ledger.start, 6);
    // The house's pools ended up holding what the traders, together, lost.
    const traders = [...ledger.balances].filter(([id]) => id !== HOUSE);
    const tradersNow = traders.reduce((sum, [, amount]) => sum + amount, 0);
    expect(tradersNow + ledger.escrow).toBeCloseTo(traders.length * 2_000 + 50_000, 6);
  });
  it('keeps every Ṁ when the pools run short and winners are scaled down', {
    timeout: 60_000,
  }, () => {
    // Pools of Ṁ300 a side instead of 25,000: the traders' winnings outgrow them often.
    const { book, ledger, counts } = simulate({
      priceSeed: '5eed5eed5eed5eed',
      tradeSeed: 7,
      days: 21,
      traders: 20,
      settings: { ...PERP_SETTINGS, subsidyLong: 300, subsidyShort: 300 },
    });
    // (Seeded: 15 prices scale winners down, 2 winners are scaled to nothing and paid their margin.)
    expect(counts.scaledDown).toBeGreaterThan(0);
    expect(counts.settledByScaling).toBeGreaterThan(0);
    expect(counts.liquidations).toBeGreaterThan(0);
    expect(counts.refused.exposure_cap).toBeGreaterThan(0);
    expect(book.state.positions).toEqual([]);
    expect(ledger.escrow).toBeCloseTo(book.state.pool.L + book.state.pool.S, 6);
    expect(ledger.total()).toBeCloseTo(ledger.start, 6);
  });
});
