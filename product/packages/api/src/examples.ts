import type { Creation, Format, Market, Shapes, Sourced, Story, Update } from '@hrizzup/agreement';
import creations from '@hrizzup/agreement/examples/creations.json' with { type: 'json' };
import markets from '@hrizzup/agreement/examples/markets.json' with { type: 'json' };
import sourced from '@hrizzup/agreement/examples/sourced.json' with { type: 'json' };
import stories from '@hrizzup/agreement/examples/stories.json' with { type: 'json' };
import updates from '@hrizzup/agreement/examples/updates.json' with { type: 'json' };
import type { ConsoleMarket, ConsoleMarketWithLog } from './console.ts';
import type { Health, Me } from './contract.ts';
import type {
  CancelOrderResult,
  MarketList,
  OrdersPage,
  PositionsPage,
  TradeResult,
} from './trading.ts';

/**
 * Example answers, for building screens before their back end exists (TRACKER.md, stages 4a and
 * 4b) and for the stand-in implementation (stand-in.ts). Content always comes from the
 * hand-over agreement's own examples (agreement/examples), typed by the agreement's generated
 * types; the tests check every one of them against the agreement's validators.
 */

export const health: Health = {
  status: 'ok',
  environment: 'staging',
  region: 'bom1',
  commit: '0000000000000000000000000000000000000000',
  checkedAt: '2026-11-08T09:30:00Z',
  services: { database: 'ok', redis: 'ok', storage: 'ok', auth: 'ok' },
};

export const me: Me = {
  id: '0196f1c8-7a2b-7c3d-8e4f-5a6b7c8d9e0f',
  email: 'delivered+screen-check-chromium@resend.dev',
  name: 'Screen check',
  signedInWith: 'test_account',
};

/**
 * The agreement's example records, by format. JSON files can't carry literal types, so they
 * are typed here; `examples.test.ts` proves each one passes its format's validator.
 */
export const content: { [F in Format]: readonly Shapes[F][] } = {
  'story/1': stories as unknown as Story[],
  'update/1': updates as unknown as Update[],
  'sourced/1': sourced as unknown as Sourced[],
  'creation/1': creations as unknown as Creation[],
  'market/1': markets as unknown as Market[],
};

const [market] = markets as unknown as Market[];
if (!market) throw new Error("The agreement's examples hold no market");

/**
 * A market as the market console shows it: the agreement's first example market (a test market
 * with a placeholder question, open, settled by hand), with the trading state and the log the
 * console adds, as an admin (the example account) made and opened it.
 */
export const consoleMarketWithLog: ConsoleMarketWithLog = {
  id: market.id,
  question: market.question,
  categories: market.categories,
  kind: market.kind,
  rules: market.rules,
  source: market.source,
  settlement: market.settlement,
  opensAt: market.opens_at,
  closesAt: market.closes_at,
  state: market.state,
  result: null,
  createdAt: market.created_at,
  updatedAt: market.updated_at,
  createdBy: { id: me.id, email: me.email },
  startingProbability: '0.50000000',
  seed: '1000.000000',
  pool: { yes: '1000.000000', no: '1000.000000' },
  probability: '0.50000000',
  held: '1000.000000',
  trades: 0,
  log: [
    {
      id: 1,
      action: 'create',
      at: market.created_at,
      by: { id: me.id, email: me.email },
      settlement: null,
    },
    {
      id: 2,
      action: 'open',
      at: market.opens_at,
      by: { id: me.id, email: me.email },
      settlement: null,
    },
  ],
};

/** The same market as a list shows it, without its log. */
export const consoleMarket: ConsoleMarket = (({ log: _log, ...rest }) => rest)(
  consoleMarketWithLog,
);

/**
 * The markets for everyone (PLAN.md step 1.7d), told as one small story on the agreement's example
 * markets: the example person (`me`, with Ṁ1,000 of play money) buys Ṁ25 of Yes in the first one,
 * open at 50%, then places a limit order to buy Ṁ10 more of Yes if it falls to 40%, and cancels it.
 */

/** The example person's Ṁ25 of Yes: 49.390243 shares, taking the market from 50% to about 51.23%. */
export const tradeResult: TradeResult = {
  status: 'filled',
  requestId: '01a1b0c4-5e00-7a10-9c3d-1f2e3d4c5b6a',
  marketId: market.id,
  tradeId: 'f3b0c6a2-8d4e-4f1a-9b7c-2e5d8a1c3f60',
  outcome: 'yes',
  amount: '25.000000',
  shares: '49.390243',
  orderAmount: '25.000000',
  limitProb: null,
  probBefore: '0.50000000',
  probAfter: '0.51234380',
  balance: '975.000000',
  position: { yes: '49.390243', no: '0.000000' },
  at: '2026-11-09T07:15:00Z',
};

/** Their limit order: Ṁ10 more of Yes, only while the market is at 40% or lower. It rests. */
export const restingOrder: TradeResult = {
  status: 'resting',
  requestId: '01a1b0d6-1a00-7b20-8e4f-3a2b1c0d9e8f',
  marketId: market.id,
  tradeId: '9a7e5c3b-1d2f-4a6b-8c9d-0e1f2a3b4c5d',
  outcome: 'yes',
  amount: '0.000000',
  shares: '0.000000',
  orderAmount: '10.000000',
  limitProb: '0.40000000',
  probBefore: '0.51234380',
  probAfter: '0.51234380',
  balance: '975.000000',
  position: { yes: '49.390243', no: '0.000000' },
  at: '2026-11-09T07:20:00Z',
};

/** And their cancel of it. */
export const cancelOrderResult: CancelOrderResult = {
  status: 'cancelled',
  requestId: '01a1b0e8-2b00-7c30-a15e-4b3c2d1e0f9a',
  marketId: market.id,
  orderId: restingOrder.tradeId,
};

/**
 * The list: every example market but the draft, newest first, the open one at its probability after
 * the trade. Settled and cancelled markets show none, nor does a market with several outcomes.
 */
export const marketList: MarketList = {
  markets: (markets as unknown as Market[])
    .filter((record) => record.state !== 'draft')
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((record) => ({
      market: record,
      probability:
        record.kind !== 'yes_no' || (record.state !== 'open' && record.state !== 'closed')
          ? null
          : record.id === market.id
            ? tradeResult.probAfter
            : '0.50000000',
    })),
  next: null,
};

/** The example person's balance and position, with the limit order still resting. */
export const positionsPage: PositionsPage = {
  balance: tradeResult.balance,
  positions: [
    {
      marketId: market.id,
      question: market.question,
      state: market.state,
      closesAt: market.closes_at,
      yes: tradeResult.position.yes,
      no: tradeResult.position.no,
      probability: tradeResult.probAfter,
    },
  ],
  next: null,
};

/** Their open orders, before the cancel: the one limit order. */
export const ordersPage: OrdersPage = {
  orders: [
    {
      id: restingOrder.tradeId,
      marketId: market.id,
      question: market.question,
      state: market.state,
      outcome: 'yes',
      orderAmount: '10.000000',
      amount: '0.000000',
      shares: '0.000000',
      limitProb: '0.40000000',
      expiresAt: null,
      createdAt: restingOrder.at,
    },
  ],
  next: null,
};
