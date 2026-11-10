/**
 * The perp's engine, as plain calculation (PLAN.md step 3.4a): opening and closing a position,
 * a new price (liquidations, then winners scaled down if the pool runs short) and hourly funding.
 *
 * Manifold's perps maths (`manifold/perps/`) gives the pieces; Manifold's server combines them
 * inside each database transaction (`backend/shared/src/perps/engine.ts` at commit 79997aa:
 * `executePerpTrade`, `executePerpClose`, `applyOracleUpdate`, `runFunding`). This file is that
 * combination with the database left out: the same steps in the same order, the same refusals,
 * returning the new book and the play money to move. The ledger writes the moves as its
 * double-entry lines; the money tests (`money.test.ts`) and the simulation prove none is created
 * or lost.
 *
 * Left out, besides the database: Manifold's bans, unique-trader bonuses, request keys and
 * events (the books keep their own), its API-key fee channel (never used: Hrizzup has no trading
 * by API key) and its other price feeds.
 *
 * Every function takes the time as `now`; nothing reads the clock.
 */
import {
  applyADL,
  applyFundingWithSolvency,
  assertPerpPositionNumbers,
  assertPerpStateNumbers,
  assertPerpStateSolvent,
  closePosition,
  computeFundingRate,
  getPerpBackingPool,
  getPerpOpenInterest,
  getPerpOpenInterestCapacity,
  isPerpSideSolvent,
  MIN_PERP_LEVERAGE,
  openPosition,
  PERP_MIN_CLOSE_FRACTION,
  type PerpState,
  perpSizeMatchesExpectation,
  processLiquidations,
  resolvePerpCloseFraction,
} from '../manifold/perps/amm.ts';
import {
  accruePerpPositionTakerFee,
  calculatePerpOpenCashFlow,
  creditPerpPoolFee,
  formatPerpFeeCents,
  getPerpTakerFeeBps,
  getPerpTakerFeeImpact,
  PERP_MAX_FEE_SHARE_OF_MARGIN,
  perpOpenFeeQuote,
  perpOwnContributionInputs,
} from '../manifold/perps/fees.ts';
import { shouldApplyFunding } from '../manifold/perps/funding.ts';
import { isEligiblePerpTick } from '../manifold/perps/orders.ts';
import type { PerpDirection, PerpPosition } from '../manifold/perps/position.ts';
import type { PerpTradingMode } from '../manifold/perps/trading-mode.ts';
import { assertPerpSettings, type PerpSettings } from './settings.ts';

/** Everything the engine needs to know about the perp between steps. */
export type PerpBook = {
  /** The perp's id, which every position carries. */
  contractId: string;
  /** Where the price comes from (the stand-in's `feedId` until step 3.4b). */
  feedId: string;
  /** The two pools and the open positions. */
  state: PerpState;
  /** The last price applied, which trades fill at, and when it was published. */
  price: number;
  priceTime: number;
  /** When the perp opened: its first funding comes a full period later. */
  createdTime: number;
  /** When funding last ran, or undefined before the first time. */
  lastFundingTime: number | undefined;
  /**
   * Why trading is paused, when a new price couldn't be applied without leaving the pools short
   * (Manifold's "solvency halt"): the price moves on, the pools and positions don't, and trading
   * stays paused until a later price applies cleanly. Null when trading isn't paused.
   */
  halt: string | null;
};

/** Play money the ledger moves for one step, always between one person and the perp's pools. */
export type PerpMove = {
  userId: string;
  /** Into the pools: `margin` and `fee`. Out of them, to the person: `payout`. */
  kind: 'margin' | 'fee' | 'payout';
  /** Never below zero. */
  amount: number;
};

export type PerpRefusal = {
  code:
    | 'trading_off' // the off switch: no opens, or (halted) no trading at all
    | 'paused' // a price couldn't be applied; see `PerpBook.halt`
    | 'stale_price' // the price is older than the settings allow
    | 'not_next_price' // orders fill only at a price published after they were placed
    | 'bad_request' // an amount, leverage or fraction that isn't valid
    | 'leverage_too_high' // more than the settings' cap (10 times)
    | 'fee_too_high' // more than the trader accepted, or half the margin or more
    | 'size_fee_unpriceable' // the size fee can't be priced against an exhausted pool
    | 'insufficient_balance'
    | 'exposure_cap' // the other side can't back this much more
    | 'no_position'
    | 'position_changed' // a part-close sized against a position that has since moved
    | 'insolvent'; // the pools couldn't back this new position
  message: string;
};

export type PerpRefused = { ok: false; refusal: PerpRefusal };

const refuse = (code: PerpRefusal['code'], message: string): PerpRefused => ({
  ok: false,
  refusal: { code, message },
});

/** The book a new perp starts with: the house's subsidy in each pool, no positions. */
export const newPerpBook = (args: {
  contractId: string;
  feedId: string;
  settings: PerpSettings;
  price: number;
  priceTime: number;
  now: number;
}): PerpBook => {
  const { contractId, feedId, settings, price, priceTime, now } = args;
  assertPerpSettings(settings);
  const state: PerpState = {
    pool: { L: settings.subsidyLong, S: settings.subsidyShort },
    positions: [],
  };
  assertPerpStateNumbers(state, price);
  return {
    contractId,
    feedId,
    state,
    price,
    priceTime,
    createdTime: now,
    lastFundingTime: undefined,
    halt: null,
  };
};

/** Manifold's `assertFreshOracleForTrading`, for our one price: no older than the settings allow. */
const priceRefusal = (book: PerpBook, settings: PerpSettings, now: number) => {
  if (book.halt !== null)
    return refuse('paused', `Trading is paused: a price couldn't be applied (${book.halt}).`);
  const age = now - book.priceTime;
  if (!Number.isFinite(age) || age < 0 || age > settings.maxPriceAgeMs)
    return refuse('stale_price', 'The price is out of date; trading resumes with the next one.');
  return null;
};

/**
 * An order fills only at a price published after it was placed (Manifold's `orders.ts`). The book
 * keeps no provider stamp, so this suits feeds Manifold doesn't treat as provider-stamped: the
 * stand-in, and a Bitcoin feed like Manifold's own. A feed named like Manifold's stamped ones
 * (`mnx-…`, `adjacent-msry`) would need the stamp kept, or every order would be refused.
 */
const nextPriceRefusal = (book: PerpBook, placedTime: number) =>
  isEligiblePerpTick(book.feedId, placedTime, { ts: book.priceTime, price: book.price })
    ? null
    : refuse('not_next_price', 'An order fills only at the first price published after it.');

/** Manifold's `assertUserPerpRowsSound`: a corrupt position is a bug, never a refusal. */
const assertUserRowsSound = (state: PerpState, userId: string) => {
  for (const row of state.positions)
    if (row.userId === userId) assertPerpPositionNumbers(row, `${row.direction} position`);
};

/** Positions liquidated or settled are gone, as they are once Manifold writes them away. */
const withoutClosed = (state: PerpState): PerpState => ({
  pool: state.pool,
  positions: state.positions.filter((p) => p.size > 0),
});

export type PerpOpenRequest = {
  userId: string;
  direction: PerpDirection;
  /** The trader's own money put in (Manifold's `mana`). */
  margin: number;
  leverage: number;
  /** When the order was placed: it fills only at a price published after this. */
  placedTime: number;
  /** The most fee the trader accepts; needed only while the size fee is on. */
  maxFee?: number;
};

export type PerpOpened = {
  ok: true;
  book: PerpBook;
  position: PerpPosition;
  fee: number;
  /** A flip first closes the trader's other side; this is what that close paid. */
  closePayout: number;
  moves: PerpMove[];
};

/**
 * Opens a position, or adds to one, at the book's price (Manifold's `executePerpTrade`). Holding
 * the other side first closes it, in the same step ("a flip"), and its payout can pay for this.
 */
export const openPerpPosition = (args: {
  book: PerpBook;
  settings: PerpSettings;
  tradingMode: PerpTradingMode;
  request: PerpOpenRequest;
  /** The trader's balance before this step. */
  balance: number;
  now: number;
}): PerpOpened | PerpRefused => {
  const { book, settings, tradingMode, request, balance, now } = args;
  const { userId, direction, margin, leverage, maxFee } = request;
  if (tradingMode !== 'enabled')
    return refuse(
      'trading_off',
      tradingMode === 'halted' ? 'Perp trading is halted.' : 'The perp is closing-only.',
    );
  if (!Number.isFinite(margin) || margin <= 0)
    return refuse('bad_request', 'The margin must be a positive amount.');
  if (!Number.isFinite(leverage) || leverage < MIN_PERP_LEVERAGE)
    return refuse('bad_request', `Leverage must be at least ${MIN_PERP_LEVERAGE}.`);
  if (maxFee !== undefined && (!Number.isFinite(maxFee) || maxFee < 0))
    return refuse('bad_request', 'The most fee accepted must be zero or more.');
  if (!Number.isFinite(balance)) throw new Error('the balance must be a finite number');
  assertPerpSettings(settings);
  if (leverage > settings.maxLeverage)
    return refuse(
      'leverage_too_high',
      `Leverage ${leverage} is more than the most allowed, ${settings.maxLeverage}.`,
    );
  const stale = priceRefusal(book, settings, now) ?? nextPriceRefusal(book, request.placedTime);
  if (stale) return stale;

  const price = book.price;
  const { state } = book;
  assertPerpStateNumbers(state, price);
  assertUserRowsSound(state, userId);

  const existingOpposite = state.positions.find(
    (p) => p.userId === userId && p.direction !== direction && p.size > 0,
  );
  const existingSame = state.positions.find(
    (p) => p.userId === userId && p.direction === direction && p.size > 0,
  );

  // The fee settings (checked with the rest above); no API-key channel here.
  const takerFeeBps = getPerpTakerFeeBps(settings);
  const takerFeeImpact = getPerpTakerFeeImpact(settings);
  if (takerFeeImpact > 0 && maxFee === undefined)
    return refuse('bad_request', 'The size fee is on: say the most fee you accept.');

  // A flip: close the other side first, at the same price, free of any fee.
  let working = state;
  let closePayout = 0;
  if (existingOpposite) {
    const closed = closePosition(working, existingOpposite, price, 1, now);
    // As in Manifold's engine: a book that can't pay a plain close is broken, a failure for an
    // operator, not a refusal for the trader.
    assertPerpStateSolvent(closed.state, price);
    working = closed.state;
    closePayout = closed.payout;
  }

  // The opening fee, priced on the size added, against the pools net of the trader's own money.
  const feeQuote = perpOpenFeeQuote({
    grossPoolDepth: getPerpBackingPool(working.pool.L, working.pool.S),
    ...perpOwnContributionInputs(existingSame, price),
    addedNotional: margin * leverage,
    baseBps: takerFeeBps,
    impact: takerFeeImpact,
  });
  const fee = feeQuote.fee;
  if (feeQuote.depthExhausted)
    return refuse('size_fee_unpriceable', 'The pool is exhausted beside your position.');
  if (maxFee !== undefined && fee > maxFee)
    return refuse(
      'fee_too_high',
      `The fee, Ṁ${formatPerpFeeCents(fee, 'up')}, is more than the Ṁ${formatPerpFeeCents(maxFee, 'down')} accepted.`,
    );
  if (fee >= margin * PERP_MAX_FEE_SHARE_OF_MARGIN)
    return refuse('fee_too_high', 'The fee would take half the margin or more.');

  const cashFlow = calculatePerpOpenCashFlow({ balance, margin, openFee: fee, closePayout });
  if (!cashFlow) throw new Error('the cash flow of an open must be finite');
  if (!cashFlow.isAffordable)
    return refuse(
      'insufficient_balance',
      `This needs Ṁ${formatPerpFeeCents(cashFlow.totalDebit, 'up')} (margin and fee); there is Ṁ${formatPerpFeeCents(cashFlow.spendableBalance, 'down')}.`,
    );

  const opened = openPosition(
    working,
    userId,
    book.contractId,
    direction,
    margin,
    leverage,
    price,
    existingSame,
    now,
  );
  const accrued = accruePerpPositionTakerFee(opened.state, opened.position, fee);
  const next = creditPerpPoolFee(accrued.state, direction, fee);

  // A new position has no profit yet, so solvency alone can't bound it: cap each side's exposure
  // against what the other side can back.
  const capacity = getPerpOpenInterestCapacity(direction, next, price);
  if (!capacity.isWithinLimit)
    return refuse(
      'exposure_cap',
      `The perp can take at most Ṁ${formatPerpFeeCents(Math.max(capacity.limit - (capacity.openInterest - opened.deltaSize), 0), 'down')} more ${direction} exposure (margin × leverage) now.`,
    );
  if (!isPerpSideSolvent(direction, next, price))
    return refuse('insolvent', 'The pools could not back this position right now.');

  const moves: PerpMove[] = [];
  if (closePayout > 0) moves.push({ userId, kind: 'payout', amount: closePayout });
  moves.push({ userId, kind: 'margin', amount: margin });
  if (fee > 0) moves.push({ userId, kind: 'fee', amount: fee });
  return {
    ok: true,
    book: { ...book, state: next },
    position: accrued.position,
    fee,
    closePayout,
    moves,
  };
};

export type PerpCloseRequest = {
  userId: string;
  direction: PerpDirection;
  /** The share of the position to close: 1 for all of it, else at least 1%. */
  fraction: number;
  /** For a part-close: the size the trader saw, so a position that moved since isn't cut. */
  expectedSize?: number;
  placedTime: number;
};

export type PerpClosed = {
  ok: true;
  book: PerpBook;
  payout: number;
  /** The share actually closed: a remainder too small to keep closes it all. */
  fraction: number;
  remainingPosition: PerpPosition | null;
  moves: PerpMove[];
};

/** Closes all or part of a position at the book's price (Manifold's `executePerpClose`). */
export const closePerpPosition = (args: {
  book: PerpBook;
  settings: PerpSettings;
  tradingMode: PerpTradingMode;
  request: PerpCloseRequest;
  now: number;
}): PerpClosed | PerpRefused => {
  const { book, settings, tradingMode, request, now } = args;
  const { userId, direction, fraction: requested, expectedSize } = request;
  if (tradingMode === 'halted') return refuse('trading_off', 'Perp trading is halted.');
  if (!Number.isFinite(requested) || requested <= 0 || requested > 1)
    return refuse('bad_request', 'The share to close must be more than 0 and at most 1.');
  if (requested < 1 && requested < PERP_MIN_CLOSE_FRACTION)
    return refuse('bad_request', `Close at least ${PERP_MIN_CLOSE_FRACTION * 100}%, or all of it.`);
  if (expectedSize !== undefined && (!Number.isFinite(expectedSize) || expectedSize <= 0))
    return refuse('bad_request', 'The expected size must be positive.');
  if (requested < 1 && expectedSize === undefined)
    return refuse('bad_request', 'Closing part of a position needs the size it was sized on.');
  assertPerpSettings(settings);

  const { state } = book;
  assertPerpStateNumbers(state, book.price);
  assertUserRowsSound(state, userId);
  const position = state.positions.find(
    (p) => p.userId === userId && p.direction === direction && p.size > 0,
  );
  if (!position) return refuse('no_position', 'There is no open position to close.');
  if (
    requested < 1 &&
    expectedSize !== undefined &&
    !perpSizeMatchesExpectation(position.size, expectedSize)
  )
    return refuse('position_changed', 'The position changed; look again before closing part.');
  const stale = priceRefusal(book, settings, now) ?? nextPriceRefusal(book, request.placedTime);
  if (stale) return stale;

  const fraction = resolvePerpCloseFraction(position, requested);
  const closed = closePosition(state, position, book.price, fraction, now);
  if (!(closed.closedSize > 0) || !(closed.closedCostBasis > 0))
    return refuse('bad_request', 'That share is too small to change the position.');
  // As in Manifold's engine: a close the pools can't pay means a broken book (a paused one has
  // already been refused above), a failure for an operator.
  assertPerpStateSolvent(closed.state, book.price);
  return {
    ok: true,
    book: { ...book, state: closed.state },
    payout: closed.payout,
    fraction: closed.fraction,
    remainingPosition: closed.remainingPosition,
    moves: closed.payout > 0 ? [{ userId, kind: 'payout', amount: closed.payout }] : [],
  };
};

export type PerpPriceApplied = {
  book: PerpBook;
  /** Positions closed by liquidation: their margin stays in the pools, nothing is paid. */
  liquidated: PerpPosition[];
  /** How far winners were scaled down on each side (1: not at all). */
  adlFactorLong: number;
  adlFactorShort: number;
  /** Winners scaled down to nothing are settled: paid what remains of their margin. */
  moves: PerpMove[];
};

/**
 * A new price (Manifold's `applyOracleUpdate` inside `runOracleUpdate`): liquidations, then, if
 * the pools can't pay every winner, winners scaled down. Liquidations and scaling run whatever the
 * off switch says, so positions always settle. If the result still leaves the pools short, the
 * price moves on but the pools and positions don't, and trading pauses (`PerpBook.halt`) until a
 * later price applies cleanly, as on Manifold.
 */
export const applyPerpPrice = (args: {
  book: PerpBook;
  price: number;
  priceTime: number;
}): PerpPriceApplied => {
  const { book, price, priceTime } = args;
  if (!(priceTime > book.priceTime)) throw new Error('a new price must be newer than the last');
  assertPerpStateNumbers(book.state, price);
  try {
    const liquidations = processLiquidations(book.state, price);
    const adl = applyADL(liquidations.state, price);
    assertPerpStateSolvent(adl.state, price);
    return {
      book: { ...book, state: withoutClosed(adl.state), price, priceTime, halt: null },
      liquidated: liquidations.liquidated,
      adlFactorLong: adl.adlFactorLong,
      adlFactorShort: adl.adlFactorShort,
      moves: adl.settled
        .filter((s) => s.payout > 0)
        .map((s): PerpMove => ({ userId: s.position.userId, kind: 'payout', amount: s.payout })),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      book: { ...book, price, priceTime, halt: reason },
      liquidated: [],
      adlFactorLong: 1,
      adlFactorShort: 1,
      moves: [],
    };
  }
};

export type PerpFundingApplied =
  | { ok: true; book: PerpBook; fundingRate: number; moves: PerpMove[] }
  /** Not due, paused, or (`reason`) the funded book couldn't be made solvent: nothing changes. */
  | { ok: false; reason: 'not_due' | 'paused' | 'stale_price' | 'insolvent' };

/**
 * Funding, once a period (Manifold's `runFunding`): the more crowded side pays the other, in
 * proportion to how lopsided the two sides' open positions are; then winners are scaled down if
 * that left the pools short. No money leaves the pools unless a winner is settled.
 */
export const applyPerpFunding = (args: {
  book: PerpBook;
  settings: PerpSettings;
  now: number;
}): PerpFundingApplied => {
  const { book, settings, now } = args;
  assertPerpSettings(settings);
  if (book.halt !== null) return { ok: false, reason: 'paused' };
  const age = now - book.priceTime;
  if (!Number.isFinite(age) || age < 0 || age > settings.maxPriceAgeMs)
    return { ok: false, reason: 'stale_price' };
  if (
    !shouldApplyFunding({
      now,
      lastFundingTime: book.lastFundingTime,
      fundingStartTime: book.createdTime,
      latestOracleTime: book.priceTime,
      fundingPeriodMs: settings.fundingPeriodMs,
    })
  )
    return { ok: false, reason: 'not_due' };
  const openInterest = getPerpOpenInterest(book.state.positions);
  const fundingRate = computeFundingRate(
    openInterest.long,
    openInterest.short,
    settings.fundingSensitivity,
    settings.maxFundingRate,
  );
  let funded: ReturnType<typeof applyFundingWithSolvency>;
  try {
    funded = applyFundingWithSolvency(book.state, fundingRate, book.price);
  } catch {
    return { ok: false, reason: 'insolvent' };
  }
  return {
    ok: true,
    book: { ...book, state: withoutClosed(funded.state), lastFundingTime: now },
    fundingRate,
    moves: funded.settled
      .filter((s) => s.payout > 0)
      .map((s): PerpMove => ({ userId: s.position.userId, kind: 'payout', amount: s.payout })),
  };
};
