import { decimal, down, type Micros, micros, toNumber, up } from '@hrizzup/ledger';
import {
  applyPerpFunding,
  applyPerpPrice,
  assertPerpStateSolvent,
  closePerpPosition,
  getPerpOpenInterest,
  type OraclePoint,
  openPerpPosition,
  type PerpBook,
  type PerpDirection,
  type PerpPosition,
  type PerpRefusal,
  type PerpSettings,
  type PerpState,
  type PerpTradingMode,
} from '@hrizzup/market-engine';

/**
 * Turning a perp step into what the database writes (PLAN.md step 3.4a). This file runs the perp's
 * engine (R3's `@hrizzup/market-engine`, Manifold's maths) on the book as `perps.begin_step` handed it
 * over, with the database's time passed in, and rounds its results once into exact play money. It
 * reads no clock and touches no database, so every case repeats exactly; `step.ts` wraps it in the
 * transaction, and `perps.apply_step` checks it.
 *
 * A step has up to three phases, in this order, each its own entry in the books:
 * - **price:** the next stand-in price, if it's newer than the book's (liquidations, then winners
 *   scaled down or settled if the pools run short);
 * - **funding:** the hourly funding (the crowded side's pool pays the other's);
 * - **trade:** an open (or a flip: the trader's other side closed first) or a close.
 *
 * Rounding, once, always so no pool and no person is ever owed more than the books hold: what a
 * person receives (a close's payout, a settlement) is rounded down, what they pay (the opening fee)
 * up, never past what they accepted; what a pool receives from the other (funding, the pools'
 * balancing) up. The margin is exactly what was asked. The books then hold a hair more than the
 * maths' floating point, never less, and every step starts again from the books' exact figures.
 */

/** A position as the database holds it (begin_step's `positions`), every figure as text. */
export type StoredPosition = {
  id: string;
  accountId: string;
  direction: PerpDirection;
  size: string;
  costBasis: string;
  originalCostBasis: string;
  takerFeeCostBasis: string;
  entryPrice: string;
  leverage: string;
  liquidationPrice: string;
  openedAt: string;
  updatedAt: string;
  closedAt?: string | null;
  closeReason?: string | null;
};

/** The settings as the database writes them (perps.settings_of): the engine's names, as text. */
export type StoredSettings = Record<keyof PerpSettings, string>;

/** What perps.begin_step hands over. */
export type StepState = {
  now: string;
  step: number;
  perp: {
    id: string;
    state: 'live' | 'retired';
    tradingMode: PerpTradingMode;
    feed: string;
    /** A test perp's own seed; null for the listed perp, whose seed is the environment's secret. */
    seed: string | null;
    standIn: { origin: string; startPrice: string; volatility: string };
    settings: StoredSettings;
    price: string | null;
    priceAt: string | null;
    fundingFrom: string;
    lastFundingAt: string | null;
    pausedReason: string | null;
    longAccountId: string;
    shortAccountId: string;
  };
  pools: { long: string; short: string };
  positions: StoredPosition[];
  trader: { accountId: string; balance: string } | null;
};

/** An open, as the person asked for it: every figure as text, as the books keep the request. */
export type OpenParams = {
  direction: PerpDirection;
  /** The person's own money put in: exact, to the millionth. */
  margin: string;
  leverage: string;
  /** The most fee they accept, when they say. */
  maxFee?: string;
};

/** A close: all of it (1) or a share (at least 0.01), sized against the position they saw. */
export type CloseParams = {
  direction?: PerpDirection;
  fraction: string;
  expectedSize?: string;
};

export type StepRequest =
  | { action: 'open'; requestId: string; params: OpenParams; placedAt: string }
  | { action: 'close'; requestId: string; params: CloseParams; placedAt: string }
  | { action: 'tick' }
  | { action: 'funding' };

export type Phase = 'price' | 'funding' | 'trade';

export type PlanMove = { phase: Phase; from: string; to: string; amount: string };

export type PlanEvent = {
  phase: Phase;
  kind: 'liquidation' | 'adl' | 'settle' | 'funding' | 'open' | 'add' | 'close';
  positionId: string;
  sizeChange: string;
  costBasisChange: string;
  margin: string;
  fee: string;
  payout: string;
};

export type PlanPosition = {
  id: string;
  accountId: string;
  direction: PerpDirection;
  size: string;
  costBasis: string;
  originalCostBasis: string;
  takerFeeCostBasis: string;
  entryPrice: string;
  leverage: string;
  liquidationPrice: string;
  openedAt: string;
  updatedAt: string;
  closeReason: 'closed' | 'flipped' | 'liquidated' | 'settled' | null;
};

/** What perps.apply_step checks and writes. */
export type Plan = {
  perp_id: string;
  action: StepRequest['action'];
  request_id: string | null;
  params: OpenParams | CloseParams | null;
  price?: { at: string; price: string };
  funding?: { rate: string; openInterestLong: string; openInterestShort: string };
  refusal?: { code: PerpRefusal['code']; message: string };
  paused_reason: string | null;
  moves: PlanMove[];
  positions: PlanPosition[];
  events: PlanEvent[];
  pools: { long: string; short: string };
};

/** The maths and the books disagree past rounding: a bug, never written. */
export class PerpPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerpPlanError';
  }
}

/** A difference too small to be anything but floating point's own: under a millionth of a Ṁ. */
const NOISE = 0.0000005;
/** How far the books' exact pools may sit from the maths' floating point after a step. */
const DRIFT = 0.0001;

/** One of the maths' figures, written out in full so it reads back as exactly the same number. */
const figure = (value: number): string => {
  if (!Number.isFinite(value)) throw new PerpPlanError(`The maths gave ${value}`);
  return Object.is(value, -0) ? '0' : String(value);
};

const iso = (ms: number) => new Date(ms).toISOString();
const keyOf = (userId: string, direction: PerpDirection) => `${userId}:${direction}`;

/** The engine's settings, from the database's text. */
export function settingsOf(stored: StoredSettings): PerpSettings {
  const settings = Object.fromEntries(
    Object.entries(stored).map(([name, value]) => [name, Number(value)]),
  ) as PerpSettings;
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isFinite(value)) throw new PerpPlanError(`The setting ${name} isn't a number`);
  }
  return settings;
}

function toEngine(position: StoredPosition, perpId: string): PerpPosition {
  return {
    userId: position.accountId,
    contractId: perpId,
    direction: position.direction,
    size: Number(position.size),
    costBasis: Number(position.costBasis),
    originalCostBasis: Number(position.originalCostBasis),
    takerFeeCostBasis: Number(position.takerFeeCostBasis),
    entryPrice: Number(position.entryPrice),
    leverage: Number(position.leverage),
    liquidationPrice: Number(position.liquidationPrice),
    openedTime: Date.parse(position.openedAt),
    updatedTime: Date.parse(position.updatedAt),
  };
}

/** The perp's book as the engine reads it, from the database's exact figures. */
export function bookOf(state: StepState): PerpBook {
  const { perp } = state;
  return {
    contractId: perp.id,
    feedId: perp.feed,
    state: {
      pool: { L: toNumber(micros(state.pools.long)), S: toNumber(micros(state.pools.short)) },
      positions: state.positions.map((position) => toEngine(position, perp.id)),
    },
    price: perp.price === null ? Number.NaN : Number(perp.price),
    priceTime: perp.priceAt === null ? Number.NEGATIVE_INFINITY : Date.parse(perp.priceAt),
    createdTime: Date.parse(perp.fundingFrom),
    lastFundingTime: perp.lastFundingAt === null ? undefined : Date.parse(perp.lastFundingAt),
    halt: perp.pausedReason,
  };
}

/** The plan as it's built: the exact pools as moves change them, and what each phase did. */
class Builder {
  long: Micros;
  short: Micros;
  readonly moves: PlanMove[] = [];
  readonly events: PlanEvent[] = [];
  /** Each position the step changed, by its ID, as it should be written. */
  readonly written = new Map<string, PlanPosition>();
  /** The database's ID for each open position, by owner and side. */
  readonly ids = new Map<string, string>();
  /** The trader's balance as the step goes. */
  balance: Micros;

  constructor(
    readonly state: StepState,
    private readonly newId: () => string,
  ) {
    this.long = micros(state.pools.long);
    this.short = micros(state.pools.short);
    this.balance = state.trader ? micros(state.trader.balance) : 0n;
    for (const position of state.positions) {
      this.ids.set(keyOf(position.accountId, position.direction), position.id);
    }
  }

  pool(direction: PerpDirection): string {
    return direction === 'long' ? this.state.perp.longAccountId : this.state.perp.shortAccountId;
  }

  idFor(position: PerpPosition): string {
    const key = keyOf(position.userId, position.direction);
    let id = this.ids.get(key);
    if (!id) {
      id = this.newId();
      this.ids.set(key, id);
    }
    return id;
  }

  /** A move of exact play money, applied to the pools it touches. */
  move(phase: Phase, from: string, to: string, amount: Micros) {
    if (amount <= 0n) return;
    this.moves.push({ phase, from, to, amount: decimal(amount) });
    const { longAccountId, shortAccountId } = this.state.perp;
    if (from === longAccountId) this.long -= amount;
    if (from === shortAccountId) this.short -= amount;
    if (to === longAccountId) this.long += amount;
    if (to === shortAccountId) this.short += amount;
    const trader = this.state.trader?.accountId;
    if (from === trader) this.balance -= amount;
    if (to === trader) this.balance += amount;
  }

  /**
   * A position as written: the engine's own figures, in full. A position written closed gives up
   * its owner and side, so a position the same person opens on that side in the same step (an add
   * right after a liquidation, say) is a new one, with a new ID.
   */
  write(position: PerpPosition, closeReason: PlanPosition['closeReason'] = null): string {
    const id = this.idFor(position);
    if (closeReason) this.ids.delete(keyOf(position.userId, position.direction));
    this.written.set(id, {
      id,
      accountId: position.userId,
      direction: position.direction,
      size: figure(position.size),
      costBasis: figure(position.costBasis),
      originalCostBasis: figure(position.originalCostBasis),
      takerFeeCostBasis: figure(position.takerFeeCostBasis ?? 0),
      entryPrice: figure(position.entryPrice),
      leverage: figure(position.leverage),
      liquidationPrice: figure(position.liquidationPrice),
      openedAt: iso(position.openedTime),
      updatedAt: iso(position.updatedTime),
      closeReason,
    });
    return id;
  }

  event(
    phase: Phase,
    kind: PlanEvent['kind'],
    positionId: string,
    sizeChange: number,
    costBasisChange: number,
    money: { margin?: Micros; fee?: Micros; payout?: Micros } = {},
  ) {
    this.events.push({
      phase,
      kind,
      positionId,
      sizeChange: figure(sizeChange),
      costBasisChange: figure(costBasisChange),
      margin: decimal(money.margin ?? 0n),
      fee: decimal(money.fee ?? 0n),
      payout: decimal(money.payout ?? 0n),
    });
  }

  /**
   * Manifold's own move of money between the pools, with no position changing (its
   * `crossSideTransfer`: positive from the short pool to the long, negative the other way): exactly
   * the maths' amount, rounded up for the pool receiving it. Floating point's own noise moves
   * nothing.
   */
  crossSide(phase: Phase, transfer: number) {
    const { longAccountId, shortAccountId } = this.state.perp;
    if (transfer > NOISE) this.move(phase, shortAccountId, longAccountId, up(transfer));
    else if (transfer < -NOISE) this.move(phase, longAccountId, shortAccountId, up(-transfer));
  }

  /** The pools as the maths left them, within rounding of the books' exact ones. */
  agreeWith(pool: PerpState['pool'], what: string) {
    if (
      Math.abs(toNumber(this.long) - pool.L) > DRIFT ||
      Math.abs(toNumber(this.short) - pool.S) > DRIFT
    ) {
      throw new PerpPlanError(
        `${what}: the books' pools (${decimal(this.long)}, ${decimal(this.short)}) and the maths' (${pool.L}, ${pool.S}) disagree`,
      );
    }
  }
}

/**
 * When a perp's next funding falls due: on hourly slots of its own from its first period, never
 * sooner than the engine takes a run (the database's perps.next_funding_at, the same rule); the
 * schedule runs it within a minute of then.
 */
export function nextFundingAt(
  fundingFrom: number,
  lastFundingAt: number | null,
  periodMs: number,
): number {
  if (lastFundingAt === null) return fundingFrom + periodMs;
  const slot = fundingFrom + (Math.floor((lastFundingAt - fundingFrom) / periodMs) + 1) * periodMs;
  return Math.max(slot, lastFundingAt + periodMs - 60_000);
}

/** Positions by owner and side. */
const indexed = (positions: PerpPosition[]) =>
  new Map(positions.map((position) => [keyOf(position.userId, position.direction), position]));

/** The price phase's events and moves: liquidations, then winners scaled down or settled. */
function pricePhase(
  plan: Builder,
  before: PerpState,
  after: PerpState,
  liquidated: PerpPosition[],
  settlements: { userId: string; amount: number }[],
  crossSideTransfer: number,
) {
  // First, as in Manifold's maths: a pool holding less than its own side's positions would be paid
  // back is topped up from the other, if the other has that much to spare.
  plan.crossSide('price', crossSideTransfer);
  const gone = indexed(liquidated);
  const now = indexed(after.positions);
  const paid = new Map(settlements.map((move) => [move.userId, move.amount]));
  for (const position of before.positions) {
    const key = keyOf(position.userId, position.direction);
    if (gone.has(key)) {
      const id = plan.write(position, 'liquidated');
      plan.event('price', 'liquidation', id, -position.size, -position.costBasis);
      continue;
    }
    const survivor = now.get(key);
    if (survivor) {
      if (survivor.size !== position.size || survivor.costBasis !== position.costBasis) {
        const id = plan.write(survivor);
        plan.event(
          'price',
          'adl',
          id,
          survivor.size - position.size,
          survivor.costBasis - position.costBasis,
        );
      }
      continue;
    }
    // Scaled down to nothing: its margin paid back from its own side's pool, rounded down.
    const payout = down(paid.get(position.userId) ?? 0);
    const id = plan.write(position, 'settled');
    plan.event('price', 'settle', id, -position.size, -position.costBasis, { payout });
    plan.move('price', plan.pool(position.direction), position.userId, payout);
  }
  plan.agreeWith(after.pool, 'A new price');
}

/** The funding phase: the crowded side's pool pays the other's, then any winner scaled down. */
function fundingPhase(
  plan: Builder,
  before: PerpState,
  funded: PerpState,
  after: PerpState,
  rate: number,
  settlements: { userId: string; amount: number }[],
  crossSideTransfer: number,
) {
  // The books take a move between the pools in funding only from the crowded side to the other: a
  // funding that left a pool short of its own side (rare; Manifold's funding draws no pool below
  // its side's reserve) waits, and the next new price balances the pools first.
  if (Math.abs(crossSideTransfer) > NOISE) {
    throw new PerpPlanError(
      'Funding would leave a pool short of its side: the next price balances it first',
    );
  }
  if (rate === 0) return;
  const crowded: PerpDirection = rate > 0 ? 'long' : 'short';
  const other: PerpDirection = rate > 0 ? 'short' : 'long';
  const crowdedPool = crowded === 'long' ? before.pool.L : before.pool.S;
  const moved = crowdedPool - (crowded === 'long' ? funded.pool.L : funded.pool.S);
  // Manifold's funding moves nothing when either pool is empty.
  if (moved <= NOISE) return;
  plan.move('funding', plan.pool(crowded), plan.pool(other), up(moved));

  const fundedNow = indexed(funded.positions);
  const afterNow = indexed(after.positions);
  const paid = new Map(settlements.map((move) => [move.userId, move.amount]));
  for (const position of before.positions) {
    const key = keyOf(position.userId, position.direction);
    const scaledByFunding = fundedNow.get(key) ?? position;
    const id = plan.idFor(position);
    plan.event(
      'funding',
      'funding',
      id,
      scaledByFunding.size - position.size,
      scaledByFunding.costBasis - position.costBasis,
    );
    const survivor = afterNow.get(key);
    if (!survivor) {
      const payout = down(paid.get(position.userId) ?? 0);
      plan.write(scaledByFunding, 'settled');
      plan.event('funding', 'settle', id, -scaledByFunding.size, -scaledByFunding.costBasis, {
        payout,
      });
      plan.move('funding', plan.pool(position.direction), position.userId, payout);
      continue;
    }
    plan.write(survivor);
    if (survivor.size !== scaledByFunding.size) {
      plan.event(
        'funding',
        'adl',
        id,
        survivor.size - scaledByFunding.size,
        survivor.costBasis - scaledByFunding.costBasis,
      );
    }
  }
  plan.agreeWith(after.pool, 'Funding');
}

/** A close's payout, in two legs as the maths paid it: from each pool, each rounded down. */
function payoutLegs(
  before: PerpState,
  after: PerpState,
  /** What the trade itself put into each pool (an open's margin and fee). */
  putIn: { long: number; short: number },
) {
  const fromLong = Math.max(before.pool.L + putIn.long - after.pool.L, 0);
  const fromShort = Math.max(before.pool.S + putIn.short - after.pool.S, 0);
  return { long: down(fromLong), short: down(fromShort) };
}

const refusal = (code: PerpRefusal['code'], message: string) => ({ code, message });

/**
 * The plan for one step, or null when there's nothing to write (a scheduled step with no new price
 * and nothing due). `priceAt` gives the perp's price at a moment (its stand-in); `newId` a new
 * position's ID.
 */
export function planStep(
  state: StepState,
  request: StepRequest,
  priceAt: (moment: number) => OraclePoint,
  newId: () => string,
): Plan | null {
  const { perp } = state;
  const now = Date.parse(state.now);
  const settings = settingsOf(perp.settings);
  const plan = new Builder(state, newId);
  const trade = request.action === 'open' || request.action === 'close';
  const base = {
    perp_id: perp.id,
    action: request.action,
    request_id: trade ? request.requestId : null,
    params: trade ? request.params : null,
  };
  const finish = (
    extra: Pick<Plan, 'price' | 'funding' | 'refusal'>,
    paused: string | null,
  ): Plan => ({
    ...base,
    ...extra,
    paused_reason: paused,
    moves: plan.moves,
    positions: [...plan.written.values()],
    events: plan.events,
    pools: { long: decimal(plan.long), short: decimal(plan.short) },
  });

  // Switched off: nothing runs. A trade is refused, with no new price.
  if (perp.state !== 'live' || perp.tradingMode === 'halted') {
    if (!trade) return null;
    return finish(
      {
        refusal: refusal(
          'trading_off',
          perp.state === 'live' ? 'Perp trading is halted.' : 'This perp is retired.',
        ),
      },
      perp.pausedReason,
    );
  }

  // 1. The price: this moment's 5-second step, if newer than the book's.
  let book = bookOf(state);
  let price: Plan['price'];
  const point = priceAt(now);
  if (perp.priceAt === null || point.ts > book.priceTime) {
    price = { at: iso(point.ts), price: figure(point.price) };
    if (perp.priceAt === null) {
      // The first price: no position can be open yet, so it only sets the book's price.
      if (book.state.positions.length > 0) {
        throw new PerpPlanError('Open positions on a perp with no price');
      }
      book = { ...book, price: point.price, priceTime: point.ts, halt: null };
    } else {
      const applied = applyPerpPrice({ book, price: point.price, priceTime: point.ts });
      if (applied.book.halt === null) {
        pricePhase(
          plan,
          book.state,
          applied.book.state,
          applied.liquidated,
          applied.moves.map((move) => ({ userId: move.userId, amount: move.amount })),
          applied.crossSideTransfer,
        );
      }
      book = applied.book;
    }
  }

  // 2. What the step is for.
  let funding: Plan['funding'];
  let refused: Plan['refusal'];
  // Funding on the perp's own hourly slots, as the books hold it (perps.next_funding_at): never
  // sooner, even where the engine's own rule (a period less a minute) would take a run.
  const fundingDue =
    request.action === 'funding' &&
    now >=
      nextFundingAt(
        Date.parse(perp.fundingFrom),
        perp.lastFundingAt ? Date.parse(perp.lastFundingAt) : null,
        settings.fundingPeriodMs,
      );
  if (request.action === 'funding') {
    const funded = fundingDue ? applyPerpFunding({ book, settings, now }) : null;
    if (funded?.ok) {
      const interest = getPerpOpenInterest(book.state.positions);
      funding = {
        rate: figure(funded.fundingRate),
        openInterestLong: figure(interest.long),
        openInterestShort: figure(interest.short),
      };
      fundingPhase(
        plan,
        book.state,
        funded.funded,
        funded.book.state,
        funded.fundingRate,
        funded.moves.map((move) => ({ userId: move.userId, amount: move.amount })),
        funded.crossSideTransfer,
      );
      book = funded.book;
    }
  } else if (request.action === 'open') {
    refused = open(plan, book, request, settings, perp.tradingMode, now, (next) => {
      book = next;
    });
  } else if (request.action === 'close') {
    refused = close(plan, book, request, settings, perp.tradingMode, now, (next) => {
      book = next;
    });
  }

  if (!trade && !price && !funding) return null;

  // The books' result, rounded, must still pay every winner (unless trading is paused).
  if (book.halt === null && plan.events.length > 0) {
    const positions = book.state.positions;
    try {
      assertPerpStateSolvent(
        { pool: { L: toNumber(plan.long), S: toNumber(plan.short) }, positions },
        book.price,
      );
    } catch (error) {
      throw new PerpPlanError(
        `Rounded, the step would leave the pools short: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return finish(
    {
      ...(price ? { price } : {}),
      ...(funding ? { funding } : {}),
      ...(refused ? { refusal: refused } : {}),
    },
    book.halt,
  );
}

/** An open (or a flip), into the plan; a refusal, or undefined when it opened. */
function open(
  plan: Builder,
  book: PerpBook,
  request: Extract<StepRequest, { action: 'open' }>,
  settings: PerpSettings,
  tradingMode: PerpTradingMode,
  now: number,
  done: (book: PerpBook) => void,
): Plan['refusal'] {
  const trader = plan.state.trader;
  if (!trader) throw new PerpPlanError('An open needs a trader');
  const { direction } = request.params;
  const margin = micros(request.params.margin);
  const maxFee = request.params.maxFee === undefined ? undefined : micros(request.params.maxFee);
  const opened = openPerpPosition({
    book,
    settings,
    tradingMode,
    request: {
      userId: trader.accountId,
      direction,
      margin: toNumber(margin),
      leverage: Number(request.params.leverage),
      placedTime: Date.parse(request.placedAt),
      ...(maxFee === undefined ? {} : { maxFee: toNumber(maxFee) }),
    },
    balance: toNumber(plan.balance),
    now,
  });
  if (!opened.ok) return opened.refusal;

  // The fee, rounded up once, never past what the trader accepted, and under half the margin.
  let fee = up(opened.fee);
  if (maxFee !== undefined && fee > maxFee) fee = maxFee;
  if (fee * 2n >= margin) {
    return refusal('fee_too_high', 'The fee would take half the margin or more.');
  }
  const side = direction === 'long' ? 'long' : 'short';
  const legs = payoutLegs(book.state, opened.book.state, {
    long: side === 'long' ? toNumber(margin) + opened.fee : 0,
    short: side === 'short' ? toNumber(margin) + opened.fee : 0,
  });
  const closePayout = legs.long + legs.short;
  // Exactly: what's put in, against the balance and the flip's payout.
  if (plan.balance + closePayout - margin - fee < 0n) {
    return refusal(
      'insufficient_balance',
      `This needs Ṁ${decimal(margin + fee)} (margin and fee); there is Ṁ${decimal(plan.balance + closePayout)}.`,
    );
  }

  // A flip: the trader's other side closed first, at the same price.
  const otherSide: PerpDirection = direction === 'long' ? 'short' : 'long';
  const opposite = book.state.positions.find(
    (position) => position.userId === trader.accountId && position.direction === otherSide,
  );
  if (opposite) {
    const id = plan.write(opposite, 'flipped');
    plan.event('trade', 'close', id, -opposite.size, -opposite.costBasis, {
      payout: closePayout,
    });
    plan.move('trade', plan.pool('long'), trader.accountId, legs.long);
    plan.move('trade', plan.pool('short'), trader.accountId, legs.short);
  } else if (closePayout > 0n) {
    throw new PerpPlanError('An open paid out with nothing to close');
  }

  const existing = book.state.positions.find(
    (position) => position.userId === trader.accountId && position.direction === direction,
  );
  const id = plan.write(opened.position);
  plan.event(
    'trade',
    existing ? 'add' : 'open',
    id,
    opened.position.size - (existing?.size ?? 0),
    opened.position.costBasis - (existing?.costBasis ?? 0),
    { margin, fee },
  );
  plan.move('trade', trader.accountId, plan.pool(direction), margin);
  plan.move('trade', trader.accountId, plan.pool(direction), fee);
  plan.agreeWith(opened.book.state.pool, 'An open');
  done(opened.book);
  return undefined;
}

/** A close, all of it or a share, into the plan; a refusal, or undefined when it closed. */
function close(
  plan: Builder,
  book: PerpBook,
  request: Extract<StepRequest, { action: 'close' }>,
  settings: PerpSettings,
  tradingMode: PerpTradingMode,
  now: number,
  done: (book: PerpBook) => void,
): Plan['refusal'] {
  const trader = plan.state.trader;
  if (!trader) throw new PerpPlanError('A close needs a trader');
  const held = book.state.positions.find((position) => position.userId === trader.accountId);
  const direction = request.params.direction ?? held?.direction ?? 'long';
  const closed = closePerpPosition({
    book,
    settings,
    tradingMode,
    request: {
      userId: trader.accountId,
      direction,
      fraction: Number(request.params.fraction),
      ...(request.params.expectedSize === undefined
        ? {}
        : { expectedSize: Number(request.params.expectedSize) }),
      placedTime: Date.parse(request.placedAt),
    },
    now,
  });
  if (!closed.ok) return closed.refusal;
  const position = book.state.positions.find(
    (candidate) => candidate.userId === trader.accountId && candidate.direction === direction,
  );
  if (!position) throw new PerpPlanError('A close with no position');
  const legs = payoutLegs(book.state, closed.book.state, { long: 0, short: 0 });
  const payout = legs.long + legs.short;
  const id = closed.remainingPosition
    ? plan.write(closed.remainingPosition)
    : plan.write(position, 'closed');
  plan.event(
    'trade',
    'close',
    id,
    (closed.remainingPosition?.size ?? 0) - position.size,
    (closed.remainingPosition?.costBasis ?? 0) - position.costBasis,
    { payout },
  );
  plan.move('trade', plan.pool('long'), trader.accountId, legs.long);
  plan.move('trade', plan.pool('short'), trader.accountId, legs.short);
  plan.agreeWith(closed.book.state.pool, 'A close');
  done(closed.book);
  return undefined;
}
