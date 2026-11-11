import type { Creation, Format, Market, Shapes, Sourced, Story, Update } from '@hrizzup/agreement';
import creations from '@hrizzup/agreement/examples/creations.json' with { type: 'json' };
import markets from '@hrizzup/agreement/examples/markets.json' with { type: 'json' };
import sourced from '@hrizzup/agreement/examples/sourced.json' with { type: 'json' };
import stories from '@hrizzup/agreement/examples/stories.json' with { type: 'json' };
import updates from '@hrizzup/agreement/examples/updates.json' with { type: 'json' };
import type { AuthSettings, EmailCodeSent } from './auth.ts';
import type { ConsoleMarket, ConsoleMarketWithLog } from './console.ts';
import type { Health, Me } from './contract.ts';
import type { ApiKey, CreatedKey, KeyList, RevokedKey } from './keys.ts';
import type {
  MarketBook,
  MarketHistory,
  MarketQuote,
  MarketTrades,
  PerpQuote,
  Price,
  PriceHistory,
} from './market-data.ts';
import type {
  ConsolePerp,
  ConsolePerpWithLog,
  PerpDetails,
  PerpPositionsPage,
  PerpTradeResult,
  RuleChange,
} from './perps.ts';
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

/** Supabase Auth's public settings, with a made-up project and key (the real ones come from Doppler). */
export const authSettings: AuthSettings = {
  supabaseUrl: 'https://exampleproject.supabase.co',
  publishableKey: 'sb_publishable_example_not_a_real_key',
};

/** An email code on its way to Resend's test inbox. */
export const emailCodeSent: EmailCodeSent = {
  email: 'delivered+app-sign-in@resend.dev',
  codeLength: 8,
  minutes: 10,
};

/** A trading key, as the keys page shows it. Its text below is made up, never a real key's. */
export const apiKey: ApiKey = {
  id: '019a7b10-4c2d-7e3f-8a4b-5c6d7e8f9a0b',
  name: 'My trading bot',
  scope: 'trade',
  shown: 'hz_demo_Exam',
  createdAt: '2026-11-11T09:30:00Z',
  lastUsedAt: null,
};

export const keyList: KeyList = { keys: [apiKey] };

export const createdKey: CreatedKey = {
  key: apiKey,
  secret: `hz_demo_Exam${'0'.repeat(39)}`,
};

export const revokedKey: RevokedKey = { key: apiKey, revokedAt: '2026-11-11T09:45:00Z' };

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
  listed: true,
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

/** The example market by its address, as the list gives it. */
export const oneMarket = marketList.markets.find((listed) => listed.market.id === market.id);

/**
 * The quote the example person asked for just before their trade: Ṁ25 of Yes, which the trade then
 * filled exactly so (PLAN.md step 3.5c's done-test).
 */
export const marketQuote: MarketQuote = {
  marketId: market.id,
  action: 'buy',
  outcome: 'yes',
  status: 'filled',
  amount: tradeResult.amount,
  shares: tradeResult.shares,
  orderAmount: tradeResult.orderAmount,
  limitProb: null,
  averagePrice: '0.50617285',
  probBefore: tradeResult.probBefore,
  probAfter: tradeResult.probAfter,
  payout: tradeResult.shares,
  at: '2026-11-09T07:14:55Z',
};

/** The example market's history: its starting chance, then the trade, then the resting order. */
export const marketHistory: MarketHistory = {
  marketId: market.id,
  range: 'all',
  from: market.opens_at,
  points: [
    { at: market.opens_at, probability: '0.50000000' },
    { at: tradeResult.at, probability: tradeResult.probAfter },
    { at: restingOrder.at, probability: restingOrder.probAfter },
  ],
};

/** Its resting orders while the limit order rests: Ṁ10 of Yes at 40%. */
export const marketBook: MarketBook = {
  marketId: market.id,
  probability: tradeResult.probAfter,
  yes: [{ limitProb: '0.40000000', amount: '10.000000', orders: 1 }],
  no: [],
};

/** Its latest trades: the one buy (the limit order filled nothing, so it isn't a trade yet). */
export const marketTrades: MarketTrades = {
  marketId: market.id,
  trades: [
    {
      id: tradeResult.tradeId,
      outcome: 'yes',
      action: 'buy',
      amount: tradeResult.amount,
      shares: tradeResult.shares,
      limitProb: null,
      probBefore: tradeResult.probBefore,
      probAfter: tradeResult.probAfter,
      at: tradeResult.at,
    },
  ],
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

/**
 * The Bitcoin perp as the console shows it the day it's made (PLAN.md step 3.4a): listed, switched
 * off, its settings Manifold's defaults with the 10-times cap, Ṁ25,000 of the house's in each pool,
 * no price applied yet, and its first rules in the rule-change log, from the migration.
 */
const perpMadeAt = '2026-11-10T10:30:00Z';
const firstRules: [RuleChange['rule'], string][] = [
  ['created', 'Bitcoin price (US dollars)'],
  [
    'stand_in',
    "stand-in-btc-usd: from 2026-01-01T00:00:00Z at 100000, volatility 0.55 a year, the environment's own seed",
  ],
  ['trading_mode', 'halted'],
  ['funding_from', perpMadeAt],
  ['max_leverage', '10'],
  ['taker_fee_bps', '10'],
  ['taker_fee_impact', '0'],
  ['funding_period_ms', '3600000'],
  ['funding_sensitivity', '1'],
  ['max_funding_rate', '0.00011415525114155251'],
  ['max_price_age_ms', '120000'],
  ['subsidy_long', '25000.000000'],
  ['subsidy_short', '25000.000000'],
];

export const consolePerpWithLog: ConsolePerpWithLog = {
  id: '01a1c501-ec40-78f6-87b6-3fb041143421',
  name: 'Bitcoin price (US dollars)',
  listed: true,
  state: 'live',
  tradingMode: 'halted',
  feed: 'stand-in-btc-usd',
  settings: {
    maxLeverage: '10',
    takerFeeBps: '10',
    takerFeeImpact: '0',
    fundingPeriodMs: '3600000',
    fundingSensitivity: '1',
    maxFundingRate: '0.00011415525114155251',
    maxPriceAgeMs: '120000',
    subsidyLong: '25000.000000',
    subsidyShort: '25000.000000',
  },
  price: null,
  priceAt: null,
  fundingFrom: perpMadeAt,
  lastFundingAt: null,
  pausedReason: null,
  pools: { long: '25000.000000', short: '25000.000000' },
  openInterest: { long: '0', short: '0' },
  openPositions: 0,
  createdAt: perpMadeAt,
  updatedAt: perpMadeAt,
  createdBy: null,
  standIn: {
    origin: '2026-01-01T00:00:00Z',
    startPrice: '100000',
    volatility: '0.55',
    ownSeed: false,
  },
  steps: 0,
  retiredAt: null,
  log: firstRules.map(([rule, newValue], index) => ({
    id: index + 1,
    at: perpMadeAt,
    by: null,
    rule,
    oldValue: null,
    newValue,
    reason:
      "The perp's first settings: Manifold's defaults with the 10-times cap (the founder's decision, 10 November 2026)",
  })),
};

/** The same perp as a list shows it, without its log. */
export const consolePerp: ConsolePerp = (({ log: _log, ...rest }) => rest)(consolePerpWithLog);

/**
 * The Bitcoin perp for everyone (PLAN.md step 3.4a), told as one small story: the perp switched on,
 * the example person (`me`, Ṁ1,000 of play money) opens a 10-times long with Ṁ100 of margin at
 * $101,234.56 (Ṁ1,000 of size, an opening fee of 10 basis points of it, Ṁ1), and a minute later
 * closes it at $102,000: their margin back from the long pool and 765.44 / 101,234.56 of their size
 * in profit from the short pool, Ṁ107.561054 in all (rounded down to the millionth).
 */
export const perpOpened: PerpTradeResult = {
  status: 'opened',
  requestId: '01a1c600-1a00-7a10-9c3d-1f2e3d4c5b6a',
  perpId: consolePerpWithLog.id,
  placedAt: '2026-11-10T10:59:57.512Z',
  at: '2026-11-10T11:00:00.120Z',
  price: '101234.56',
  priceAt: '2026-11-10T11:00:00Z',
  margin: '100.000000',
  fee: '1.000000',
  payout: '0.000000',
  position: {
    id: '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8',
    perpId: consolePerpWithLog.id,
    direction: 'long',
    size: '1000',
    margin: '100',
    entryPrice: '101234.56',
    leverage: '10',
    liquidationPrice: '91111.104',
    feesPaid: '1',
    openedAt: '2026-11-10T11:00:00.12Z',
    updatedAt: '2026-11-10T11:00:00.12Z',
  },
  balance: '899.000000',
};

export const perpClosed: PerpTradeResult = {
  status: 'closed',
  requestId: '01a1c601-2b00-7b20-8e4f-3a2b1c0d9e8f',
  perpId: consolePerpWithLog.id,
  placedAt: '2026-11-10T10:59:59.003Z',
  at: '2026-11-10T11:01:00.150Z',
  price: '102000',
  priceAt: '2026-11-10T11:01:00Z',
  margin: '0.000000',
  fee: '0.000000',
  payout: '107.561054',
  position: null,
  balance: '1006.561054',
};

/** The perp's details while the position is open, at $101,500. */
export const perpDetails: PerpDetails = {
  id: consolePerpWithLog.id,
  name: consolePerpWithLog.name,
  listed: true,
  state: 'live',
  tradingMode: 'enabled',
  feed: consolePerpWithLog.feed,
  settings: consolePerpWithLog.settings,
  price: '101500',
  priceAt: '2026-11-10T11:00:30Z',
  nextPriceAt: '2026-11-10T11:00:35Z',
  bookPrice: '101500',
  bookPriceAt: '2026-11-10T11:00:30Z',
  pausedReason: null,
  pools: { long: '25101.000000', short: '25000.000000' },
  openInterest: { long: '1000', short: '0' },
  openPositions: 1,
  fundingRate: '0',
  lastFundingAt: null,
  nextFundingAt: '2026-11-10T11:30:00Z',
};

/** The quote the example person saw before opening: at $101,200, a moment before the next price. */
export const perpQuote: PerpQuote = {
  perpId: consolePerpWithLog.id,
  direction: 'long',
  margin: '100.000000',
  leverage: '10',
  size: '1000',
  fee: '1.000000',
  cost: '101.000000',
  price: '101200',
  priceAt: '2026-11-10T10:59:55Z',
  liquidationPrice: '91080',
  at: '2026-11-10T10:59:57.000Z',
};

/** Our own Bitcoin price then: the median of three exchanges' prices, to the cent. */
export const price: Price = {
  feed: 'btc-usd',
  price: '101200.00',
  at: '2026-11-10T10:59:55Z',
  sources: 3,
  publishedAt: '2026-11-10T10:59:55.412Z',
};

/** Its last 15 seconds, as a history over the last hour would end. */
export const priceHistory: PriceHistory = {
  feed: 'btc-usd',
  range: '1h',
  from: '2026-11-10T09:59:57Z',
  points: [
    { at: '2026-11-10T10:59:45Z', price: '101180.50' },
    { at: '2026-11-10T10:59:50Z', price: '101192.25' },
    { at: price.at, price: price.price },
  ],
};

/** The example person's position then, worth Ṁ102.622029 at $101,500. */
export const perpPositionsPage: PerpPositionsPage = {
  balance: perpOpened.balance,
  positions: [
    {
      ...(perpOpened.position as NonNullable<PerpTradeResult['position']>),
      perpName: consolePerpWithLog.name,
      tradingMode: 'enabled',
      price: '101500',
      value: '102.622029',
      profit: '1.622029',
    },
  ],
  next: null,
};
