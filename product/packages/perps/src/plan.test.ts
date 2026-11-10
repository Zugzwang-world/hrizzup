import { decimal, micros, toNumber } from '@hrizzup/ledger';
import { standInPrice } from '@hrizzup/market-engine';
import { describe, expect, it } from 'vitest';
import {
  type Plan,
  planStep,
  type StepRequest,
  type StepState,
  type StoredPosition,
} from './plan.ts';

/**
 * The step planner against a small, exact copy of the books (no database): each plan's moves are
 * applied as the books apply them, its positions written as the database writes them, and the next
 * step starts from those exact figures, as a real one does. After every step: nothing made or lost
 * (people, pools and the house sum to what they started with, to the millionth); no pool and nobody
 * below zero; every move a whole millionth; each person's moves what their events say; and a long
 * random run of opens, adds, flips, closes, prices, liquidations and fundings on a test perp that
 * moves fast, with the price coming from the stand-in as on staging.
 */

const PERP = '01a1c599-0000-7000-8000-000000000001';
const LONG_POOL = '00000000-0000-4000-8000-00000000a001';
const SHORT_POOL = '00000000-0000-4000-8000-00000000a002';
const SEED = '0f1e2d3c4b5a6978';

class Books {
  balances = new Map<string, bigint>();
  positions = new Map<string, StoredPosition>();
  price: string | null = null;
  priceAt: string | null = null;
  lastFundingAt: string | null = null;
  pausedReason: string | null = null;
  steps = 0;
  readonly start: bigint;
  constructor(
    traders: string[],
    readonly standIn: { origin: string; startPrice: string; volatility: string },
    readonly fundingFrom: string,
    readonly subsidy: { long: string; short: string } = { long: '1000', short: '1000' },
    starting = '1000',
  ) {
    this.balances.set(LONG_POOL, micros(subsidy.long));
    this.balances.set(SHORT_POOL, micros(subsidy.short));
    for (const trader of traders) this.balances.set(trader, micros(starting));
    this.start = this.total();
  }
  /** Seats the book as it stands: its pools, positions and price (the conservation total anew). */
  seat(
    pools: { long: string; short: string },
    positions: StoredPosition[],
    price: string,
    at: number,
  ) {
    this.balances.set(LONG_POOL, micros(pools.long));
    this.balances.set(SHORT_POOL, micros(pools.short));
    for (const position of positions) this.positions.set(position.id, position);
    this.price = price;
    this.priceAt = new Date(at).toISOString();
    (this as { start: bigint }).start = this.total();
  }
  total() {
    let sum = 0n;
    for (const value of this.balances.values()) sum += value;
    return sum;
  }
  state(now: number, trader: string | null): StepState {
    return {
      now: new Date(now).toISOString(),
      step: this.steps + 1,
      perp: {
        id: PERP,
        state: 'live',
        tradingMode: 'enabled',
        feed: 'stand-in-btc-usd',
        seed: SEED,
        standIn: this.standIn,
        settings: {
          maxLeverage: '10',
          takerFeeBps: '10',
          takerFeeImpact: '0',
          fundingPeriodMs: '3600000',
          fundingSensitivity: '1',
          maxFundingRate: '0.0001',
          maxPriceAgeMs: '120000',
          subsidyLong: this.subsidy.long,
          subsidyShort: this.subsidy.short,
        },
        price: this.price,
        priceAt: this.priceAt,
        fundingFrom: this.fundingFrom,
        lastFundingAt: this.lastFundingAt,
        pausedReason: this.pausedReason,
        longAccountId: LONG_POOL,
        shortAccountId: SHORT_POOL,
      },
      pools: {
        long: decimal(this.balances.get(LONG_POOL) ?? 0n),
        short: decimal(this.balances.get(SHORT_POOL) ?? 0n),
      },
      positions: [...this.positions.values()],
      trader: trader
        ? { accountId: trader, balance: decimal(this.balances.get(trader) ?? 0n) }
        : null,
    };
  }
  /** Applies a plan as the database does, checking the books' own rules as it goes. */
  apply(plan: Plan, now: number) {
    this.checkTheBooksRules(plan);
    for (const move of plan.moves) {
      const amount = micros(move.amount);
      expect(amount > 0n, 'a move is more than zero').toBe(true);
      this.balances.set(move.from, (this.balances.get(move.from) ?? 0n) - amount);
      this.balances.set(move.to, (this.balances.get(move.to) ?? 0n) + amount);
    }
    for (const [account, balance] of this.balances) {
      expect(balance >= 0n, `${account} below zero: ${decimal(balance)}`).toBe(true);
    }
    expect(plan.pools.long).toBe(decimal(this.balances.get(LONG_POOL) ?? 0n));
    expect(plan.pools.short).toBe(decimal(this.balances.get(SHORT_POOL) ?? 0n));
    // Each person's moves, each way, are exactly what their events say.
    const byPerson = new Map<string, { in: bigint; out: bigint }>();
    const owner = new Map(plan.positions.map((p) => [p.id, p.accountId]));
    for (const event of plan.events) {
      const account =
        owner.get(event.positionId) ?? this.positions.get(event.positionId)?.accountId;
      if (!account) throw new Error('An event on a position the plan does not name');
      const sums = byPerson.get(`${event.phase}:${account}`) ?? { in: 0n, out: 0n };
      sums.in += micros(event.payout);
      sums.out += micros(event.margin) + micros(event.fee);
      byPerson.set(`${event.phase}:${account}`, sums);
    }
    const moved = new Map<string, { in: bigint; out: bigint }>();
    for (const move of plan.moves) {
      for (const [account, way] of [
        [move.to, 'in'],
        [move.from, 'out'],
      ] as const) {
        if (account === LONG_POOL || account === SHORT_POOL) continue;
        const sums = moved.get(`${move.phase}:${account}`) ?? { in: 0n, out: 0n };
        sums[way] += micros(move.amount);
        moved.set(`${move.phase}:${account}`, sums);
      }
    }
    for (const key of new Set([...byPerson.keys(), ...moved.keys()])) {
      expect(moved.get(key) ?? { in: 0n, out: 0n }, key).toEqual(
        byPerson.get(key) ?? { in: 0n, out: 0n },
      );
    }
    for (const position of plan.positions) {
      if (position.closeReason) this.positions.delete(position.id);
      else
        this.positions.set(position.id, {
          ...position,
          updatedAt: new Date(now).toISOString(),
          openedAt: position.openedAt,
        });
    }
    if (plan.price) {
      this.price = plan.price.price;
      this.priceAt = plan.price.at;
    }
    if (plan.funding) this.lastFundingAt = new Date(now).toISOString();
    this.pausedReason = plan.paused_reason;
    this.steps += 1;
    expect(this.total(), 'nothing made, nothing lost').toBe(this.start);
  }

  counts = { poolTopUps: 0 };

  /**
   * Two of the database's own rules (perps.apply_step), checked here so the planner can't break
   * them unseen: nothing happens to a position after it closes in a step (a closed position's last
   * event closes it), and with a new price the pools balance one way only, worked out from the
   * positions as the price left them, each side's reserve being what its positions would be paid
   * back at the price (each one's margin, or its worth if less): a pool topped up only when it holds
   * less than its reserve, never past it, by a pool that keeps its own.
   */
  checkTheBooksRules(plan: Plan) {
    const closing = new Set(['liquidation', 'settle', 'close']);
    for (const position of plan.positions) {
      if (!position.closeReason) continue;
      const last = plan.events.filter((event) => event.positionId === position.id).at(-1);
      expect(last && closing.has(last.kind), `${position.id} closes with its last event`).toBe(
        true,
      );
    }
    for (const position of plan.positions) {
      if (position.closeReason) continue;
      const closedBefore = plan.events.some(
        (event) =>
          event.positionId === position.id &&
          (event.kind === 'liquidation' || event.kind === 'settle'),
      );
      expect(closedBefore, `${position.id} is written open after it closed`).toBe(false);
    }
    const across = plan.moves.filter(
      (move) =>
        move.phase === 'price' &&
        [LONG_POOL, SHORT_POOL].includes(move.from) &&
        [LONG_POOL, SHORT_POOL].includes(move.to),
    );
    if (across.length === 0) return;
    this.counts.poolTopUps += 1;
    expect(new Set(across.map((move) => move.from)).size, 'one way only').toBe(1);
    const price = Number(plan.price?.price ?? this.price);
    const gone = new Set(
      plan.events
        .filter(
          (event) => event.phase === 'price' && ['liquidation', 'settle'].includes(event.kind),
        )
        .map((event) => event.positionId),
    );
    const afterPrice = [...this.positions.values()]
      .filter((position) => !gone.has(position.id))
      .map((position) => {
        const sizeChange = plan.events
          .filter((event) => event.phase === 'price' && event.positionId === position.id)
          .reduce((sum, event) => sum + Number(event.sizeChange), 0);
        const size = Number(position.size) + sizeChange;
        const entry = Number(position.entryPrice);
        const margin = Number(position.costBasis);
        const pnl =
          ((position.direction === 'long' ? price - entry : entry - price) / entry) * size;
        return {
          direction: position.direction,
          margin,
          reserve: Math.min(margin, Math.max(margin + pnl, 0)),
        };
      });
    const priceFlow = (pool: string) =>
      plan.moves
        .filter((move) => move.phase === 'price' && (move.from === pool || move.to === pool))
        .reduce((sum, move) => sum + (move.to === pool ? 1 : -1) * Number(move.amount), 0);
    const from = across[0]?.from as string;
    const to = across[0]?.to as string;
    const sideOf = (pool: string) => (pool === LONG_POOL ? 'long' : 'short');
    const sum = (side: string, key: 'margin' | 'reserve') =>
      afterPrice.filter((p) => p.direction === side).reduce((total, p) => total + p[key], 0);
    const receiverBefore = toNumber(this.balances.get(to) ?? 0n);
    const receiverAfter = receiverBefore + priceFlow(to);
    const payerAfter = toNumber(this.balances.get(from) ?? 0n) + priceFlow(from);
    expect(receiverBefore, 'only a pool that is short is topped up').toBeLessThan(
      sum(sideOf(to), 'reserve') + 0.000001,
    );
    expect(receiverAfter, "never past its side's reserve").toBeLessThanOrEqual(
      sum(sideOf(to), 'reserve') + 0.000001,
    );
    expect(
      payerAfter,
      'the paying pool keeps what its own side would be paid back',
    ).toBeGreaterThanOrEqual(sum(sideOf(from), 'reserve') - 0.000001);
  }
}

let ids = 0;
const newId = () => `0c000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;

describe('the step planner', () => {
  const origin = Date.UTC(2026, 10, 10, 9, 0, 0);
  const standIn = { origin: new Date(origin).toISOString(), startPrice: '100', volatility: '0.55' };
  const walk = { origin, startPrice: 100, annualVolatility: 0.55 };
  const priceAt = (moment: number) => standInPrice(SEED, moment, walk);

  it('opens a 10-times long: exactly the margin asked, the fee rounded up, both into the long pool', () => {
    const books = new Books(['ann'], standIn, standIn.origin);
    const now = origin + 60_000;
    const request: StepRequest = {
      action: 'open',
      requestId: '01a1c600-0000-7000-8000-000000000001',
      params: { direction: 'long', margin: '100', leverage: '10' },
      placedAt: new Date(now - 6_000).toISOString(),
    };
    const plan = planStep(books.state(now, 'ann'), request, priceAt, newId);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.refusal).toBeUndefined();
    expect(plan.price?.at).toBe(new Date(priceAt(now).ts).toISOString());
    expect(plan.moves).toEqual([
      { phase: 'trade', from: 'ann', to: LONG_POOL, amount: '100.000000' },
      { phase: 'trade', from: 'ann', to: LONG_POOL, amount: '1.000000' },
    ]);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({ kind: 'open', margin: '100.000000', fee: '1.000000' });
    books.apply(plan, now);
    expect(decimal(books.balances.get('ann') ?? 0n)).toBe('899.000000');
  });

  it('refuses more than 10 times leverage, and more than the balance, moving nothing', () => {
    const books = new Books(['ann'], standIn, standIn.origin);
    const now = origin + 60_000;
    const placedAt = new Date(now - 6_000).toISOString();
    for (const [params, code] of [
      [{ direction: 'long', margin: '100', leverage: '11' }, 'leverage_too_high'],
      [{ direction: 'short', margin: '999.5', leverage: '1' }, 'insufficient_balance'],
    ] as const) {
      const plan = planStep(
        books.state(now, 'ann'),
        { action: 'open', requestId: newId(), params, placedAt },
        priceAt,
        newId,
      );
      expect(plan?.refusal?.code).toBe(code);
      expect(plan?.moves).toEqual([]);
    }
  });

  it('closes at a profit: the margin from its own pool, the profit from the other', () => {
    const books = new Books(['raj'], standIn, standIn.origin);
    // Find two moments half an hour apart with the price at least 0.4% lower at the second: a short
    // whose profit (0.4% of its 250 dollars) is more than its two fees (0.1% of 250 each way).
    const held = 1_800_000;
    let at = origin + 60_000;
    while (priceAt(at + held).price >= priceAt(at).price * 0.996) at += 5_000;
    const open = planStep(
      books.state(at, 'raj'),
      {
        action: 'open',
        requestId: newId(),
        params: { direction: 'short', margin: '50', leverage: '5' },
        placedAt: new Date(at - 6_000).toISOString(),
      },
      priceAt,
      newId,
    );
    if (!open) throw new Error('no plan');
    books.apply(open, at);
    const later = at + held;
    const close = planStep(
      books.state(later, 'raj'),
      {
        action: 'close',
        requestId: newId(),
        params: { fraction: '1' },
        placedAt: new Date(later - 6_000).toISOString(),
      },
      priceAt,
      newId,
    );
    if (!close) throw new Error('no plan');
    expect(close.refusal).toBeUndefined();
    const fromShort = close.moves.find((m) => m.from === SHORT_POOL);
    const fromLong = close.moves.find((m) => m.from === LONG_POOL);
    expect(fromShort?.amount).toBe('50.000000');
    expect(micros(fromLong?.amount ?? '0') > 0n).toBe(true);
    books.apply(close, later);
    // Exactly what the events say: the margin and the fee out, the payout back.
    const opened = open.events[0];
    const closed = close.events.find((e) => e.kind === 'close');
    expect(closed).toBeDefined();
    expect(books.balances.get('raj')).toBe(
      micros('1000') -
        micros(opened?.margin ?? '0') -
        micros(opened?.fee ?? '0') +
        micros(closed?.payout ?? '0'),
    );
    expect((books.balances.get('raj') ?? 0n) > micros('1000')).toBe(true);
  });

  /** A price for each 5-second step, set by the test as it goes. */
  const scripted = () => {
    let price = 100;
    return {
      set: (next: number) => {
        price = next;
      },
      at: (moment: number) => ({
        ts: origin + Math.floor((moment - origin) / 5_000) * 5_000,
        price,
      }),
    };
  };
  const placed = (now: number) => new Date(now - 6_000).toISOString();
  const opening = (direction: 'long' | 'short', margin: string, leverage: string, now: number) =>
    ({
      action: 'open',
      requestId: newId(),
      params: { direction, margin, leverage },
      placedAt: placed(now),
    }) satisfies StepRequest;
  const closingAll = (now: number) =>
    ({
      action: 'close',
      requestId: newId(),
      params: { fraction: '1' },
      placedAt: placed(now),
    }) satisfies StepRequest;

  it('tops a pool up from the other with a new price when its own side would be paid back more than it holds', () => {
    // The money review's case: a short closes at a profit paid from the long pool while the longs
    // are losing; the price comes back, and the long pool holds less than the longs are worth. The
    // perp froze here before: every price and trade refused.
    // Ṁ100 in the long pool, Ṁ1,000 in the short; two 10-times longs of Ṁ500 and a 10-times short
    // of Ṁ1,000, each inside the exposure cap.
    const books = new Books(
      ['ann', 'bob', 'cid'],
      standIn,
      standIn.origin,
      { long: '100', short: '1000' },
      '5000',
    );
    const price = scripted();
    let now = origin + 10_000;
    for (const [trader, request] of [
      ['ann', opening('long', '500', '10', now)],
      ['cid', opening('long', '500', '10', now)],
      ['bob', opening('short', '1000', '10', now)],
    ] as const) {
      const plan = planStep(books.state(now, trader), request, price.at, newId);
      if (!plan) throw new Error('no plan');
      expect(plan.refusal).toBeUndefined();
      books.apply(plan, now);
    }
    now += 5_000;
    price.set(91);
    const closed = planStep(books.state(now, 'bob'), closingAll(now), price.at, newId);
    if (!closed) throw new Error('no plan');
    books.apply(closed, now);
    // Bob's margin back from the short pool, his Ṁ900 of profit from the long pool.
    expect([books.balances.get(LONG_POOL), books.balances.get(SHORT_POOL)]).toEqual([
      micros('210'),
      micros('1010'),
    ]);
    now += 5_000;
    price.set(99);
    const tick = planStep(books.state(now, null), { action: 'tick' }, price.at, newId);
    if (!tick) throw new Error('no plan');
    // At $99 each long is worth Ṁ450: Ṁ690 more between them than the long pool's Ṁ210, from the
    // short pool, which no position needs. No position changes.
    expect(tick.moves).toEqual([
      { phase: 'price', from: SHORT_POOL, to: LONG_POOL, amount: '690.000000' },
    ]);
    expect(tick.events).toEqual([]);
    books.apply(tick, now);
    expect(books.counts.poolTopUps).toBe(1);
    // And trading carries on: Ann closes.
    const annCloses = planStep(books.state(now, 'ann'), closingAll(now), price.at, newId);
    expect(annCloses?.refusal).toBeUndefined();
    if (annCloses) books.apply(annCloses, now);
  });

  it('opens a new position for an add whose own step liquidates the one it was adding to', () => {
    const books = new Books(['ann'], standIn, standIn.origin);
    const price = scripted();
    let now = origin + 10_000;
    const opened = planStep(
      books.state(now, 'ann'),
      opening('long', '100', '10', now),
      price.at,
      newId,
    );
    if (!opened) throw new Error('no plan');
    books.apply(opened, now);
    const first = opened.positions[0]?.id;
    // The add's own step reaches $89 first, past the long's $90: liquidated, then the add opens anew.
    now += 5_000;
    price.set(89);
    const add = planStep(books.state(now, 'ann'), opening('long', '50', '2', now), price.at, newId);
    if (!add) throw new Error('no plan');
    expect(add.refusal).toBeUndefined();
    expect(
      add.events.map((event) => [event.phase, event.kind, event.positionId === first]),
    ).toEqual([
      ['price', 'liquidation', true],
      ['trade', 'open', false],
    ]);
    expect(add.positions.find((position) => position.id === first)?.closeReason).toBe('liquidated');
    books.apply(add, now);
  });

  it('scales a winner down when the other pool can’t pay all their profit, and pays exactly that', () => {
    // R3's money test: pools of Ṁ100 a side; a 10-times long of Ṁ100 (Ṁ1,000 of size, the cap's
    // limit); at +20% a profit of Ṁ200 against Ṁ100 in the short pool: scaled down by half.
    const books = new Books(['ana'], standIn, standIn.origin, { long: '100', short: '100' });
    const price = scripted();
    let now = origin + 10_000;
    const opened = planStep(
      books.state(now, 'ana'),
      opening('long', '100', '10', now),
      price.at,
      newId,
    );
    if (!opened) throw new Error('no plan');
    books.apply(opened, now);
    now += 5_000;
    price.set(120);
    const tick = planStep(books.state(now, null), { action: 'tick' }, price.at, newId);
    if (!tick) throw new Error('no plan');
    expect(tick.events.map((event) => [event.phase, event.kind])).toEqual([['price', 'adl']]);
    expect(Number(tick.positions[0]?.size)).toBeCloseTo(500, 9);
    books.apply(tick, now);
    const closed = planStep(books.state(now, 'ana'), closingAll(now), price.at, newId);
    if (!closed) throw new Error('no plan');
    // Her margin of Ṁ100 and her scaled profit of Ṁ100: the short pool emptied, nothing made.
    expect(closed.events[0]?.payout).toBe('200.000000');
    books.apply(closed, now);
    expect(books.balances.get(SHORT_POOL)).toBe(0n);
  });

  it('settles a winner scaled down to nothing after topping the other pool up, in one new price', () => {
    // R3's money test, after Manifold's incidents: the short pool holds Ṁ80 against a short's Ṁ100
    // of margin. At +10% the short is worth Ṁ90: the long pool tops the short pool up by Ṁ10, which
    // leaves nothing for the long's profit, so the long is settled: her margin back, from her own
    // pool. All in one new price, the pools balanced one way and the books exact.
    const books = new Books(['ana', 'ben'], standIn, standIn.origin);
    const at = origin + 10_000;
    const row = (id: string, accountId: string, direction: 'long' | 'short', size: string) => ({
      id,
      accountId,
      direction,
      size,
      costBasis: '100',
      originalCostBasis: '100',
      takerFeeCostBasis: '0',
      entryPrice: '100',
      leverage: String(Number(size) / 100),
      liquidationPrice: String(
        direction === 'long' ? 100 * (1 - 100 / Number(size)) : 100 * (1 + 100 / Number(size)),
      ),
      openedAt: new Date(at).toISOString(),
      updatedAt: new Date(at).toISOString(),
    });
    books.seat(
      { long: '200', short: '80' },
      [
        row('0c000000-0000-4000-8000-0000000000aa', 'ana', 'long', '1000'),
        row('0c000000-0000-4000-8000-0000000000bb', 'ben', 'short', '100'),
      ],
      '100',
      at,
    );
    const price = scripted();
    price.set(110);
    const now = at + 5_000;
    const tick = planStep(books.state(now, null), { action: 'tick' }, price.at, newId);
    if (!tick) throw new Error('no plan');
    expect(tick.paused_reason).toBeNull();
    expect(tick.events.map((event) => [event.kind, event.payout])).toEqual([
      ['settle', '100.000000'],
    ]);
    expect(tick.moves).toEqual(
      expect.arrayContaining([
        { phase: 'price', from: LONG_POOL, to: SHORT_POOL, amount: '10.000000' },
        { phase: 'price', from: LONG_POOL, to: 'ana', amount: '100.000000' },
      ]),
    );
    books.apply(tick, now);
    expect([books.balances.get(LONG_POOL), books.balances.get(SHORT_POOL)]).toEqual([
      micros('90'),
      micros('90'),
    ]);
    expect([...books.positions.values()].map((position) => position.accountId)).toEqual(['ben']);
  });

  it('runs a long random session without making or losing a millionth', () => {
    // A test perp that moves fast (4,000% a year), so liquidations, settlements and funding happen.
    const fast = { origin: new Date(origin).toISOString(), startPrice: '100', volatility: '40' };
    const fastWalk = { origin, startPrice: 100, annualVolatility: 40 };
    const fastPrice = (moment: number) => standInPrice(SEED, moment, fastWalk);
    const traders = Array.from({ length: 8 }, (_, i) => `t${i}`);
    // Funding's first period started two hours ago, so it runs at the first funding step.
    const books = new Books(traders, fast, new Date(origin - 7_200_000).toISOString());
    let random = 0x2545f491;
    const next = () => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return (random >>> 0) / 2 ** 32;
    };
    const counts = {
      opens: 0,
      closes: 0,
      partCloses: 0,
      refusals: 0,
      liquidations: 0,
      fundings: 0,
      ticks: 0,
    };
    let now = origin + 10_000;
    for (let i = 0; i < 1_500; i++) {
      now += Math.floor(next() * 4_000);
      const roll = next();
      const trader = traders[Math.floor(next() * traders.length)] as string;
      let request: StepRequest;
      if (roll < 0.15) request = { action: 'tick' };
      else if (roll < 0.17) request = { action: 'funding' };
      else if (roll < 0.6) {
        request = {
          action: 'open',
          requestId: newId(),
          params: {
            direction: next() < 0.5 ? 'long' : 'short',
            margin: (1 + Math.floor(next() * 120)).toString(),
            leverage: String(1 + Math.floor(next() * 12)),
          },
          placedAt: new Date(now - 6_000).toISOString(),
        };
      } else {
        const held = [...books.positions.values()].find(
          (position) => position.accountId === trader,
        );
        const all = next() < 0.6;
        request = {
          action: 'close',
          requestId: newId(),
          params:
            all || !held
              ? { fraction: '1' }
              : // A part-close, sized on the position as the trader last saw it.
                { fraction: '0.5', expectedSize: held.size },
          placedAt: new Date(now - 6_000).toISOString(),
        };
      }
      const trading = request.action === 'open' || request.action === 'close';
      const plan = planStep(books.state(now, trading ? trader : null), request, fastPrice, newId);
      if (!plan) continue;
      if (plan.refusal) counts.refusals += 1;
      else if (request.action === 'open') counts.opens += 1;
      else if (request.action === 'close') {
        counts.closes += 1;
        if (request.params.fraction !== '1') counts.partCloses += 1;
      }
      if (plan.funding) counts.fundings += 1;
      if (request.action === 'tick') counts.ticks += 1;
      counts.liquidations += plan.events.filter((e) => e.kind === 'liquidation').length;
      books.apply(plan, now);
    }
    expect(counts.opens).toBeGreaterThan(100);
    expect(counts.closes).toBeGreaterThan(50);
    expect(counts.partCloses).toBeGreaterThan(20);
    expect(counts.refusals).toBeGreaterThan(10);
    expect(counts.liquidations).toBeGreaterThan(0);
    expect(counts.fundings).toBeGreaterThan(0);
  }, 60_000);
});
