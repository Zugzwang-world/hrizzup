import {
  type BinaryContract,
  getBinaryCpmmBetInfo,
  getCpmmProbability,
  getCpmmSellBetInfo,
  type LimitBet,
  MAX_CPMM_PROB,
  MIN_CPMM_PROB,
  noFees,
  TAKER_FEE_RATE,
} from '@hrizzup/market-engine';
import {
  decimal,
  down,
  fromNumber,
  type Micros,
  micros,
  min,
  split,
  toNumber,
  up,
} from './decimal.ts';

/**
 * Turning a trade request into what the database writes (PLAN.md step 1.7b): this file runs
 * Manifold's maths (@hrizzup/market-engine) on the market as the database handed it over, with
 * the time passed in, and rounds the results once into exact amounts. It reads no clock and
 * touches no database, so every case here repeats exactly; `trade.ts` wraps it in the
 * transaction.
 */

export type Outcome = 'YES' | 'NO';

/** One trade request. Its `requestId` is chosen by the sender: a retry sends the same one. */
export type TradeRequest =
  | {
      action: 'buy';
      requestId: string;
      marketId: string;
      outcome: Outcome;
      /** What to spend, in Ṁ, as exact decimal text. */
      amount: string;
      /** A limit order: buy only up to this probability (as decimal text, 0.01 to 0.99). */
      limitProb?: string;
      /** When a limit order stops filling, if ever. */
      expiresAt?: Date;
    }
  | {
      action: 'sell';
      requestId: string;
      marketId: string;
      outcome: Outcome;
      /** How many shares to sell, as exact decimal text. */
      shares: string;
    }
  | {
      action: 'cancel_order';
      requestId: string;
      marketId: string;
      /** The resting limit order to withdraw. */
      orderId: string;
    };

/** Why a trade was refused; stored as the request's result, so a retry gets the same answer. */
export type Refusal =
  | 'market_not_open'
  | 'market_closed'
  | 'insufficient_balance'
  | 'not_enough_shares'
  | 'price_limit'
  | 'no_open_order';

/** What begin_trade hands over: the market and everyone the trade can touch, under lock. */
export type MarketState = {
  now: string;
  market: {
    id: string;
    state: string;
    closes_at: string;
    p: string;
    pool_yes: string;
    pool_no: string;
    seed: string;
  };
  account: { id: string; balance: string };
  position: { yes: string; no: string };
  orders: {
    id: string;
    account_id: string;
    outcome: Outcome;
    order_amount: string;
    amount: string;
    shares: string;
    limit_prob: string;
    expires_at: string | null;
    created_at: string;
  }[];
  balances: Record<string, string>;
};

/** What apply_trade writes: the maths' results, rounded once, as exact decimal text. */
export type Plan = {
  request_id: string;
  market_id: string;
  action: TradeRequest['action'];
  params: Record<string, string>;
  refusal?: Refusal;
  trade?: {
    id: string;
    outcome: Outcome;
    order_amount?: string;
    limit_prob?: string;
    expires_at?: string;
    is_filled: boolean;
  };
  fills?: { matched: string | null; amount: string; shares: string }[];
  makers?: { order_id: string; amount: string; shares: string }[];
  cancel?: string[];
  pool?: { yes: string; no: string };
};

/** A request that can never be traded as sent (the caller's mistake, not a refusal). */
export class TradeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradeInputError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The least either side of a pool may keep after a trade, in Ṁ. */
const MIN_POOL_SIDE = 0.0001;
const PROBABILITY = /^0\.\d{1,8}$/;

/**
 * The request's own parameters, as the database stores them beside its ID: a retry must send
 * the same ones. Checks every input first, so nothing malformed reaches the maths.
 */
export function paramsOf(request: TradeRequest): Record<string, string> {
  for (const id of [request.requestId, request.marketId]) {
    if (!UUID.test(id)) throw new TradeInputError('Request and market IDs are UUIDs');
  }
  switch (request.action) {
    case 'buy': {
      checkOutcome(request.outcome);
      const amount = positive(request.amount, 'An amount');
      const params: Record<string, string> = { outcome: request.outcome, amount: decimal(amount) };
      if (request.limitProb !== undefined) {
        const limit = Number(request.limitProb);
        if (
          !PROBABILITY.test(request.limitProb) ||
          limit < MIN_CPMM_PROB ||
          limit > MAX_CPMM_PROB
        ) {
          throw new TradeInputError('A limit is a probability from 0.01 to 0.99');
        }
        params.limitProb = limit.toFixed(8);
      }
      if (request.expiresAt !== undefined) {
        if (request.limitProb === undefined) {
          throw new TradeInputError('Only a limit order can expire');
        }
        if (Number.isNaN(request.expiresAt.getTime())) {
          throw new TradeInputError('An expiry is a time');
        }
        params.expiresAt = request.expiresAt.toISOString();
      }
      return params;
    }
    case 'sell':
      checkOutcome(request.outcome);
      return { outcome: request.outcome, shares: decimal(positive(request.shares, 'Shares')) };
    case 'cancel_order':
      if (!UUID.test(request.orderId)) throw new TradeInputError('An order ID is a UUID');
      return { orderId: request.orderId.toLowerCase() };
    default:
      throw new TradeInputError('Unknown trade action');
  }
}

function checkOutcome(outcome: string) {
  if (outcome !== 'YES' && outcome !== 'NO') throw new TradeInputError('The outcome is YES or NO');
}

function positive(text: string, what: string): Micros {
  let value: Micros;
  try {
    value = micros(text);
  } catch {
    throw new TradeInputError(`${what} is a number with at most six decimal places`);
  }
  if (value <= 0n) throw new TradeInputError(`${what} must be more than zero`);
  return value;
}

/** The market as Manifold's maths sees it (our slim yes/no type). */
export function contractOf(state: MarketState): BinaryContract {
  const pool = {
    YES: toNumber(micros(state.market.pool_yes)),
    NO: toNumber(micros(state.market.pool_no)),
  };
  const p = Number(state.market.p);
  return {
    id: state.market.id,
    visibility: 'public',
    closeTime: Date.parse(state.market.closes_at),
    isResolved: false,
    collectedFees: noFees,
    mechanism: 'cpmm-1',
    outcomeType: 'BINARY',
    pool,
    p,
    totalLiquidity: toNumber(micros(state.market.seed)),
    subsidyPool: 0,
    initialProbability: p,
    prob: getCpmmProbability(pool, p),
    probChanges: { day: 0, week: 0, month: 0 },
  };
}

/** The resting orders as Manifold's limit orders, in the order they were placed. */
export function ordersOf(state: MarketState): LimitBet[] {
  return state.orders.map((order) => ({
    id: order.id,
    userId: order.account_id,
    contractId: state.market.id,
    createdTime: Date.parse(order.created_at),
    amount: toNumber(micros(order.amount)),
    loanAmount: 0,
    outcome: order.outcome,
    shares: toNumber(micros(order.shares)),
    probBefore: 0,
    probAfter: 0,
    fees: noFees,
    isRedemption: false,
    orderAmount: toNumber(micros(order.order_amount)),
    limitProb: Number(order.limit_prob),
    isFilled: false,
    isCancelled: false,
    fills: [],
    ...(order.expires_at ? { expiresAt: Date.parse(order.expires_at) } : {}),
  }));
}

type Results = {
  amount: number;
  shares: number;
  fills: { matchedBetId: string | null; amount: number; shares: number }[];
  makers: { bet: LimitBet; amount: number; shares: number }[];
  ordersToCancel: LimitBet[];
  newPool: { [outcome: string]: number };
  fees: { creatorFee: number; platformFee: number; liquidityFee: number };
};

/**
 * The refusal, if any, for a request on this market as it stands: checked before the maths,
 * inside the transaction, so closing times are always checked by the trade itself.
 */
export function refusalFor(request: TradeRequest, state: MarketState): Refusal | undefined {
  if (state.market.state !== 'open') return 'market_not_open';
  if (Date.parse(state.now) >= Date.parse(state.market.closes_at)) return 'market_closed';
  if (request.action === 'buy') {
    if (micros(request.amount) > micros(state.account.balance)) return 'insufficient_balance';
  }
  if (request.action === 'sell') {
    const held = request.outcome === 'YES' ? state.position.yes : state.position.no;
    if (micros(request.shares) > micros(held)) return 'not_enough_shares';
  }
  return undefined;
}

/**
 * Runs the maths for a buy or a sale on the market as the database handed it over, and rounds
 * the results once, always in the house's favour: what a person receives (shares, sale
 * proceeds) is rounded down, what they pay never above what they asked or hold, and a resting
 * order pays at least its limit price for the shares it gets. Returns the plan apply_trade
 * writes, or a refusal.
 */
export function planTrade(
  request: Extract<TradeRequest, { action: 'buy' | 'sell' }>,
  state: MarketState,
  tradeId: string,
): Plan {
  if (TAKER_FEE_RATE !== 0) {
    // The fee stays zero until the Product chat decides one; the books have no line for it yet.
    throw new Error('A fee is set, but the books do not record fees yet');
  }
  const base = {
    request_id: request.requestId.toLowerCase(),
    market_id: request.marketId.toLowerCase(),
    action: request.action,
    params: paramsOf(request),
  };
  const refusal = refusalFor(request, state);
  if (refusal) return { ...base, refusal };

  const now = Date.parse(state.now);
  const contract = contractOf(state);
  const orders = ordersOf(state);
  const balances = Object.fromEntries(
    Object.entries(state.balances).map(([id, balance]) => [id, toNumber(micros(balance))]),
  );
  // What each order's owner can still pay: the maths stops at their balance, and so does the
  // rounding, so a resting order never takes anyone below zero.
  const available = new Map(Object.entries(state.balances).map(([id, b]) => [id, micros(b)]));
  // What's left of each resting order, which a fill never goes past.
  const remaining = new Map(
    state.orders.map((order) => [order.id, micros(order.order_amount) - micros(order.amount)]),
  );
  const limits = new Map(state.orders.map((order) => [order.id, order]));

  let results: Results;
  let amountTotal: Micros;
  let sharesTotal: Micros;
  let limitProb: string | undefined;
  let expiresAt: string | undefined;
  let isFilled = true;
  let orderAmount: string | undefined;

  if (request.action === 'buy') {
    const asked = micros(request.amount);
    const limit = request.limitProb === undefined ? undefined : Number(request.limitProb);
    if (request.expiresAt !== undefined && request.expiresAt.getTime() <= now) {
      throw new TradeInputError('An expiry must be in the future');
    }
    const info = getBinaryCpmmBetInfo(
      contract,
      request.outcome,
      toNumber(asked),
      limit,
      orders,
      balances,
      request.expiresAt?.getTime(),
      undefined,
      now,
    );
    const bet = info.newBet;
    results = {
      amount: bet.amount,
      shares: bet.shares,
      fills: bet.fills ?? [],
      makers: info.makers,
      ordersToCancel: info.ordersToCancel,
      newPool: info.newPool,
      fees: bet.fees,
    };
    if (limit === undefined && results.fills.length === 0) {
      return { ...base, refusal: 'price_limit' };
    }
    // Paid: rounded up, but never past what was asked. Shares got: rounded down.
    amountTotal = min(up(bet.amount), asked);
    sharesTotal = down(bet.shares);
    orderAmount = decimal(asked);
    if (limit !== undefined) {
      limitProb = limit.toFixed(8);
      // Filled once nothing is left of it, even where the maths' own flag (comparing floating
      // point) says otherwise.
      isFilled = (bet.isFilled ?? false) || asked - amountTotal <= 1n;
      if (request.expiresAt !== undefined) expiresAt = request.expiresAt.toISOString();
    }
  } else {
    const selling = micros(request.shares);
    // Manifold's sale searches for the amount that buys back the shares, and stops within a
    // millionth of them (relative), above or below. Never selling more than was asked (often
    // all the trader holds), it asks again, for that much less, when the maths overshoots.
    let asking = selling;
    let info = sellInfo(asking);
    for (let attempt = 0; attempt < 4 && up(-info.newBet.shares) > selling; attempt++) {
      asking -= up(-info.newBet.shares) - selling + 1n;
      if (asking <= 0n) break;
      info = sellInfo(asking);
    }
    // Still more than asked (a sale so small, or a price so extreme, the search can't land it):
    // refused, as a result a retry gets again, rather than sold unbacked.
    if (up(-info.newBet.shares) > selling) return { ...base, refusal: 'price_limit' };
    const bet = info.newBet;
    results = {
      amount: bet.amount,
      shares: bet.shares,
      fills: bet.fills ?? [],
      makers: info.makers,
      ordersToCancel: info.ordersToCancel,
      newPool: info.newPool,
      fees: bet.fees,
    };
    // Money back (negative): rounded down. Shares sold: rounded up, but never past those asked
    // for (so exactly those, whenever the maths agrees to a millionth).
    amountTotal = -down(-bet.amount);
    sharesTotal = -min(up(-bet.shares), selling);
  }

  function sellInfo(shares: Micros) {
    if (request.action !== 'sell') throw new Error('Only a sale asks the maths to sell');
    return getCpmmSellBetInfo(
      toNumber(shares),
      request.outcome,
      contract,
      orders,
      balances,
      undefined,
      now,
    );
  }

  // A trade that would leave a side of the pool almost empty (a sale can push the price past
  // the 1% and 99% a buy stops at) is refused: under Ṁ0.0001, a side can't be kept exactly.
  if (
    (results.newPool.YES as number) < MIN_POOL_SIDE ||
    (results.newPool.NO as number) < MIN_POOL_SIDE
  ) {
    return { ...base, refusal: 'price_limit' };
  }

  const feeTotal = results.fees.creatorFee + results.fees.platformFee + results.fees.liquidityFee;
  if (feeTotal !== 0) throw new Error('The maths charged a fee, which the books do not record yet');

  // Each resting order pays its limit price for the shares it gets: what it pays rounded up,
  // never past its owner's balance or what's left of the order; the shares rounded down, never
  // more than it paid for. An order whose fill rounds to nothing (the maths' own leftovers, a
  // hair above zero) is left out, with the trader's matching fill: the database refuses a fill
  // of nothing.
  const makers = results.makers
    .map((maker) => {
      const order = limits.get(maker.bet.id);
      if (!order) throw new Error(`The maths filled an order it wasn't given: ${maker.bet.id}`);
      const price =
        order.outcome === 'YES' ? Number(order.limit_prob) : 1 - Number(order.limit_prob);
      const owner = maker.bet.userId;
      const left = available.get(owner) ?? 0n;
      const amount = min(min(up(maker.amount), left), remaining.get(order.id) ?? 0n);
      available.set(owner, left - amount);
      const shares = min(down(maker.shares), down(toNumber(amount) / price));
      return { order_id: maker.bet.id, amount, shares };
    })
    .filter((maker) => maker.amount > 0n);
  const kept = new Set(makers.map((maker) => maker.order_id));
  const takerFills = results.fills.filter(
    (fill) => fill.matchedBetId === null || kept.has(fill.matchedBetId),
  );
  const amounts = split(
    amountTotal,
    takerFills.map((fill) => fill.amount),
  );
  const shares = split(
    sharesTotal,
    takerFills.map((fill) => fill.shares),
  );
  const fills = takerFills.map((fill, i) => ({
    matched: fill.matchedBetId,
    amount: decimal(amounts[i] as Micros),
    shares: decimal(shares[i] as Micros),
  }));

  return {
    ...base,
    trade: {
      id: tradeId,
      outcome: request.outcome,
      ...(orderAmount === undefined ? {} : { order_amount: orderAmount }),
      ...(limitProb === undefined ? {} : { limit_prob: limitProb }),
      ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
      is_filled: isFilled,
    },
    fills,
    makers: makers.map((maker) => ({
      order_id: maker.order_id,
      amount: decimal(maker.amount),
      shares: decimal(maker.shares),
    })),
    cancel: results.ordersToCancel.map((order) => order.id),
    pool: {
      yes: decimal(fromNumber(results.newPool.YES as number)),
      no: decimal(fromNumber(results.newPool.NO as number)),
    },
  };
}
