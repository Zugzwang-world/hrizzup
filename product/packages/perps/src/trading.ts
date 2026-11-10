import type {
  ClosePerpInput,
  HeldPerpPosition,
  OpenPerpInput,
  PerpDetails,
  PerpList,
  PerpPosition,
  PerpPositionsPage,
  PerpRefusal,
  PerpTradeResult,
} from '@hrizzup/api';
import { errorCode, type Transaction, transaction } from '@hrizzup/db';
import { decimal, down, micros, up } from '@hrizzup/ledger';
import {
  type PerpPosition as EnginePosition,
  getPerpFundingRate,
  getPositionValue,
  getUserFacingPnl,
  STAND_IN_PRICE,
} from '@hrizzup/market-engine';
import type { Pool } from 'pg';
import type { StepState, StoredPosition, StoredSettings } from './plan.ts';
import { PerpNotSetUpError, type PriceSource, priceFor, runStep } from './step.ts';

/**
 * The perp for everyone (PLAN.md step 3.4a; blueprint sections 5 and 13): its price and details,
 * anyone's to read; and for the signed-in person, opening, closing and their own positions. Each read
 * is one transaction through the server's one database helper (`@hrizzup/db`), as the app's own role;
 * each trade is one step (`step.ts`), under the perp's lock.
 *
 * A trade is refused **before it touches the books** when it plainly can't trade (the perp switched
 * off or closing only, more than the perp's leverage, more than the balance, nothing to close), with
 * no lock taken and nothing written; the books check everything again under the lock, where a refusal
 * is stored under the request's ID like every answer. **A retry always gets its first answer:** when
 * the person has already sent this request ID, these checks are skipped and the books answer.
 *
 * **Orders fill at the next new price, never the one on screen** (PLAN.md, "Starting rules"): the
 * order is placed at the database's own time, and the step runs once the next 5-second price is
 * published, a few seconds at most.
 */

type Database = Pick<Pool, 'connect'>;

export type PerpTradingErrorKind = 'not_found' | 'conflict' | 'invalid' | 'refused';

export class PerpTradingError extends Error {
  constructor(
    readonly kind: PerpTradingErrorKind,
    message: string,
    readonly reason?: PerpRefusal,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PerpTradingError';
  }
}

const refused = (reason: PerpRefusal, message: string) =>
  new PerpTradingError('refused', message, reason);

/** What begin_step answers when a request ID comes back with a different request. */
const ID_USED = 'This request ID was already used for a different request';

/** A database failure as a PerpTradingError, when it is one; anything else as it was. */
export function asPerpTradingError(error: unknown): unknown {
  if (error instanceof PerpTradingError || error instanceof PerpNotSetUpError) return error;
  switch (errorCode(error)) {
    case '23505':
      // Only begin_step's own answer: any other duplicate is a fault, never the person's.
      if (!(error instanceof Error) || error.message !== ID_USED) return error;
      return new PerpTradingError('conflict', ID_USED, undefined, { cause: error });
    case 'P0002':
      return new PerpTradingError('not_found', 'No such perp', undefined, { cause: error });
    case '22023':
    case '22P02':
      return new PerpTradingError(
        'invalid',
        error instanceof Error ? error.message : 'Refused',
        undefined,
        { cause: error },
      );
    default:
      return error;
  }
}

async function read<R>(
  pool: Database,
  account: string | null,
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  try {
    return await transaction(pool, work, { account });
  } catch (error) {
    throw asPerpTradingError(error);
  }
}

/** A perp as perps.view() gives it to anyone. */
type PublicPerp = {
  id: string;
  name: string;
  listed: boolean;
  state: 'live' | 'retired';
  tradingMode: PerpDetails['tradingMode'];
  feed: string;
  settings: StoredSettings;
  price: string | null;
  priceAt: string | null;
  fundingFrom: string;
  lastFundingAt: string | null;
  pausedReason: string | null;
  pools: { long: string; short: string };
  openInterest: { long: string; short: string };
  openPositions: number;
};

type Sources = Record<
  string,
  { feed: string; seed: string | null; standIn: StepState['perp']['standIn'] }
>;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A number of the maths as the contract writes it: plain decimal text, never JavaScript's exponent
 * form (a funding rate of 5.7e-7 is 0.00000057), every digit the number has.
 */
export function plain(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
  if (Object.is(value, -0) || value === 0) return '0';
  const text = String(value);
  if (!/e/i.test(text)) return text;
  const [digits = '', power = '0'] = text.toLowerCase().split('e');
  const negative = digits.startsWith('-');
  const [whole = '', fraction = ''] = digits.replace('-', '').split('.');
  const exponent = Number(power);
  const all = whole + fraction;
  const point = whole.length + exponent;
  const out =
    point <= 0
      ? `0.${'0'.repeat(-point)}${all}`
      : point >= all.length
        ? all + '0'.repeat(point - all.length)
        : `${all.slice(0, point)}.${all.slice(point)}`;
  const trimmed = out.includes('.') ? out.replace(/0+$/, '').replace(/\.$/, '') : out;
  return `${negative ? '-' : ''}${trimmed.replace(/^0+(?=\d)/, '')}`;
}

/**
 * When a perp's next funding falls due: on hourly slots of its own from its first period, never
 * sooner than the engine takes a run (the database's perps.next_funding_at, the rule the schedule
 * follows); it runs within a minute of then.
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

/** A perp's price now, from its own walk (and seed), or the environment's secret seed. */
function priceNow(perp: PublicPerp, sources: Sources, source: PriceSource, now: number) {
  const where = sources[perp.id];
  if (!where) throw new PerpTradingError('not_found', 'No such perp');
  return priceFor(where, source)(now);
}

function details(
  perp: PublicPerp,
  sources: Sources,
  source: PriceSource,
  now: number,
): PerpDetails {
  const point = priceNow(perp, sources, source, now);
  const period = Number(perp.settings.fundingPeriodMs);
  const fundingRate = getPerpFundingRate({
    openInterestLong: Number(perp.openInterest.long),
    openInterestShort: Number(perp.openInterest.short),
    fundingSensitivity: Number(perp.settings.fundingSensitivity),
    maxFundingRate: Number(perp.settings.maxFundingRate),
  });
  const nextFunding = nextFundingAt(
    Date.parse(perp.fundingFrom),
    perp.lastFundingAt ? Date.parse(perp.lastFundingAt) : null,
    period,
  );
  return {
    id: perp.id,
    name: perp.name,
    listed: perp.listed,
    state: perp.state,
    tradingMode: perp.tradingMode,
    feed: perp.feed,
    settings: perp.settings,
    price: plain(point.price),
    priceAt: iso(point.ts),
    nextPriceAt: iso(point.ts + STAND_IN_PRICE.intervalMs),
    bookPrice: perp.price,
    bookPriceAt: perp.priceAt,
    pausedReason: perp.pausedReason,
    pools: perp.pools,
    openInterest: perp.openInterest,
    openPositions: perp.openPositions,
    fundingRate: plain(fundingRate),
    lastFundingAt: perp.lastFundingAt,
    nextFundingAt: iso(nextFunding),
  };
}

/**
 * The database's own time, in milliseconds, read in the same statement: "now" for a price shown is
 * always the clock orders are placed by, so nobody is ever shown a 5-second step's price before the
 * database has reached that step (and could place an order that fills at a price they've seen).
 */
const DATABASE_NOW = '(extract(epoch from clock_timestamp()) * 1000)::bigint as now_ms';

/** One perp by its address, with its price now. Anyone may read it: nobody is signed in for it. */
export async function perpDetails(
  pool: Database,
  id: string,
  source: PriceSource,
): Promise<PerpDetails> {
  const found = await read(pool, null, async (tx) => {
    const { rows } = await tx.query<{ perp: PublicPerp | null; sources: Sources; now_ms: string }>(
      `select perps.details($1) as perp, perps.price_sources(array[$1]::uuid[]) as sources, ${DATABASE_NOW}`,
      [id],
    );
    return rows[0];
  });
  if (!found?.perp) throw new PerpTradingError('not_found', 'No such perp');
  return details(found.perp, found.sources, source, Number(found.now_ms));
}

/** The listed perps (the Bitcoin perp), each with its price now. */
export async function listedPerps(pool: Database, source: PriceSource): Promise<PerpList> {
  const found = await read(pool, null, async (tx) => {
    // The price sources of the listed perps alone, in the same statement.
    const { rows } = await tx.query<{ perps: PublicPerp[]; sources: Sources; now_ms: string }>(
      `with listed as (select perps.listed() as perps)
       select listed.perps,
              perps.price_sources(array(
                select (item ->> 'id')::uuid from jsonb_array_elements(listed.perps) item)) as sources,
              ${DATABASE_NOW}
       from listed`,
    );
    return rows[0];
  });
  const at = Number(found?.now_ms ?? Number.NaN);
  return {
    perps: (found?.perps ?? []).map((perp) => details(perp, found?.sources ?? {}, source, at)),
  };
}

/** What perps.holdings reads before a trade, with no lock. */
type Holdings = {
  perpId: string;
  state: 'live' | 'retired';
  tradingMode: PerpDetails['tradingMode'];
  settings: StoredSettings;
  pausedReason: string | null;
  priceAt: string | null;
  stepsFrom: string;
  hasAccount: boolean;
  balance: string;
  position: StoredPosition | null;
  answered: boolean;
  now: string;
};

async function holdings(
  pool: Database,
  account: string,
  perpId: string,
  requestId: string,
): Promise<Holdings> {
  const found = await read(pool, account, async (tx) => {
    const { rows } = await tx.query<{ answer: Holdings | null }>(
      'select perps.holdings($1, $2) as answer',
      [perpId, requestId],
    );
    return rows[0]?.answer ?? null;
  });
  if (!found) throw new PerpTradingError('not_found', 'No such perp');
  return found;
}

/** The person's position as the contract has it. */
function asPosition(position: StoredPosition, perpId: string): PerpPosition {
  return {
    id: position.id,
    perpId,
    direction: position.direction,
    size: position.size,
    margin: position.costBasis,
    entryPrice: position.entryPrice,
    leverage: position.leverage,
    liquidationPrice: position.liquidationPrice,
    feesPaid: position.takerFeeCostBasis,
    openedAt: position.openedAt,
    updatedAt: position.updatedAt,
  };
}

/** What perps.apply_step stored as a trade's answer. */
type StoredResult = {
  status: 'opened' | 'added' | 'closed' | 'refused';
  request_id: string;
  perp_id: string;
  at: string;
  placed_at: string;
  price: string;
  price_at: string;
  margin: string;
  fee: string;
  payout: string;
  position: StoredPosition | null;
  balance: string;
  refusal?: { code: PerpRefusal; message: string };
};

function asTradeResult(result: StoredResult): PerpTradeResult {
  if (result.status === 'refused') {
    throw refused(result.refusal?.code ?? 'bad_request', result.refusal?.message ?? 'Refused');
  }
  return {
    status: result.status,
    requestId: result.request_id,
    perpId: result.perp_id,
    placedAt: result.placed_at,
    at: result.at,
    price: result.price,
    priceAt: result.price_at,
    margin: result.margin,
    fee: result.fee,
    payout: result.payout,
    position: result.position ? asPosition(result.position, result.perp_id) : null,
    balance: result.balance,
  };
}

/** When the perp's next 5-second step starts after `placed` (its steps start at `stepsFrom`). */
export function nextStepAt(placed: number, stepsFrom: number): number {
  const interval = STAND_IN_PRICE.intervalMs;
  return stepsFrom + (Math.floor((placed - stepsFrom) / interval) + 1) * interval;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TradeOptions = {
  /** Waits until the next price (default: a real wait; tests may skip time). */
  wait?: (ms: number) => Promise<void>;
};

async function trade(
  pool: Database,
  account: string,
  perpId: string,
  request:
    | { action: 'open'; requestId: string; params: Record<string, string> }
    | { action: 'close'; requestId: string; params: Record<string, string> },
  held: Holdings,
  source: PriceSource,
  options: TradeOptions,
): Promise<PerpTradeResult> {
  const placedAt = held.now;
  if (!held.answered) {
    // Wait for the next price, outside any transaction: the order fills at a price published after
    // it was placed. The wait is measured from the database's own clock, so this server's doesn't
    // matter.
    const placed = Date.parse(placedAt);
    const wait = nextStepAt(placed, Date.parse(held.stepsFrom)) - placed + 150;
    await (options.wait ?? sleep)(wait);
  }
  try {
    const answer = await runStep(
      pool,
      account,
      perpId,
      { ...request, placedAt } as Parameters<typeof runStep>[3],
      source,
    );
    if (answer.kind !== 'applied' && answer.kind !== 'replay') {
      throw new Error(`A trade's step answered ${answer.kind}`);
    }
    return asTradeResult(answer.result as unknown as StoredResult);
  } catch (error) {
    throw asPerpTradingError(error);
  }
}

/**
 * Opens a position, or adds to one, at the next new price: for the signed-in `account`. Refused
 * before the books when the perp is off or closing only, the leverage is past its cap, or the margin
 * and fee are more than the balance (unless a flip's payout could pay for it).
 */
export async function openPerp(
  pool: Database,
  account: string,
  input: OpenPerpInput,
  source: PriceSource,
  options: TradeOptions = {},
): Promise<PerpTradeResult> {
  const held = await holdings(pool, account, input.perpId, input.requestId);
  if (!held.answered) {
    if (held.state !== 'live' || held.tradingMode === 'halted') {
      throw refused('trading_off', 'Perp trading is halted.');
    }
    if (held.tradingMode === 'reduce-only') {
      throw refused('trading_off', 'The perp is closing-only: no new positions.');
    }
    if (Number(input.leverage) > Number(held.settings.maxLeverage)) {
      throw refused(
        'leverage_too_high',
        `Leverage ${input.leverage} is more than the most allowed, ${held.settings.maxLeverage}.`,
      );
    }
    const flip = held.position !== null && held.position.direction !== input.direction;
    if (!flip && Number(held.settings.takerFeeImpact) === 0) {
      // The flat fee: 10 basis points of the size by default, rounded up as the books round it.
      const margin = micros(input.margin);
      const fee = up(
        (Number(input.margin) * Number(input.leverage) * Number(held.settings.takerFeeBps)) /
          10_000,
      );
      if (margin + fee > micros(held.balance)) {
        throw refused(
          'insufficient_balance',
          `This needs Ṁ${decimal(margin + fee)} (margin and fee); there is Ṁ${held.balance}.`,
        );
      }
    }
  }
  const params: Record<string, string> = {
    direction: input.direction,
    margin: input.margin,
    leverage: input.leverage,
    ...(input.maxFee === undefined ? {} : { maxFee: input.maxFee }),
  };
  return trade(
    pool,
    account,
    input.perpId,
    { action: 'open', requestId: input.requestId, params },
    held,
    source,
    options,
  );
}

/** Closes all of a position or a share of it, at the next new price: for the signed-in `account`. */
export async function closePerp(
  pool: Database,
  account: string,
  input: ClosePerpInput,
  source: PriceSource,
  options: TradeOptions = {},
): Promise<PerpTradeResult> {
  const held = await holdings(pool, account, input.perpId, input.requestId);
  if (!held.answered) {
    if (held.state !== 'live' || held.tradingMode === 'halted') {
      throw refused('trading_off', 'Perp trading is halted.');
    }
    if (!held.position || (input.direction && held.position.direction !== input.direction)) {
      throw refused('no_position', 'There is no open position to close.');
    }
  }
  const params: Record<string, string> = {
    fraction: input.fraction,
    ...(input.direction === undefined ? {} : { direction: input.direction }),
    ...(input.expectedSize === undefined ? {} : { expectedSize: input.expectedSize }),
  };
  return trade(
    pool,
    account,
    input.perpId,
    { action: 'close', requestId: input.requestId, params },
    held,
    source,
    options,
  );
}

/** What perps.positions() gives: a position with its perp's name, off switch and book price. */
type StoredHeld = StoredPosition & {
  perpId: string;
  perpName: string;
  tradingMode: PerpDetails['tradingMode'];
  price: string | null;
  priceAt: string | null;
};

/** The signed-in person's balance and open perp positions, each worth what it is at the price now. */
export async function perpPositions(
  pool: Database,
  account: string,
  page: { after?: string | undefined },
  source: PriceSource,
): Promise<PerpPositionsPage> {
  const found = await read(pool, account, async (tx) => {
    const { rows } = await tx.query<{
      page: { balance: string; positions: StoredHeld[]; next: string | null };
      sources: Sources;
      now_ms: string;
    }>(
      // The price sources of this page's perps alone, in the same statement.
      `with held as (select perps.positions($1, $2) as page)
       select held.page,
              perps.price_sources(array(
                select distinct (item ->> 'perpId')::uuid
                from jsonb_array_elements(held.page -> 'positions') item)) as sources,
              ${DATABASE_NOW}
       from held`,
      [page.after ?? null, 50],
    );
    return rows[0];
  });
  if (!found) throw new Error('The database answered nothing');
  const at = Number(found.now_ms);
  const positions: HeldPerpPosition[] = found.page.positions.map((held) => {
    let price: number | null = null;
    try {
      const where = found.sources[held.perpId];
      if (where) {
        price = priceFor(where, source)(at).price;
      }
    } catch (error) {
      if (!(error instanceof PerpNotSetUpError)) throw error;
    }
    const engine: EnginePosition = {
      userId: held.accountId,
      contractId: held.perpId,
      direction: held.direction,
      size: Number(held.size),
      costBasis: Number(held.costBasis),
      originalCostBasis: Number(held.originalCostBasis),
      takerFeeCostBasis: Number(held.takerFeeCostBasis),
      entryPrice: Number(held.entryPrice),
      leverage: Number(held.leverage),
      liquidationPrice: Number(held.liquidationPrice),
      openedTime: Date.parse(held.openedAt),
      updatedTime: Date.parse(held.updatedAt),
    };
    const value = price === null ? null : getPositionValue(engine, price);
    const profit = price === null ? null : getUserFacingPnl(engine, price);
    return {
      ...asPosition(held, held.perpId),
      perpName: held.perpName,
      tradingMode: held.tradingMode,
      price: price === null ? null : String(price),
      // Worth, as a close at this price would pay it: rounded down to the millionth.
      value: value === null ? null : decimal(down(value)),
      profit: profit === null ? null : decimal(down(profit)),
    };
  });
  return { balance: found.page.balance, positions, next: found.page.next };
}
