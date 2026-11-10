import { z } from 'zod';
import { decimal, moment, recordId } from './console.ts';
import { forbidden } from './keys.ts';
import { nextCursor, pageInput } from './paging.ts';

/**
 * The Bitcoin perp's part of the contract (PLAN.md step 3.4a; blueprint section 13). This file
 * holds the console's: what an admin sees of a perp (its off switch, its settings, its book and its
 * rule-change log) and what they send to change it, or to make and retire a check run's own test
 * perp. Only admins may make these calls; to everyone else, signed in or not, they answer exactly
 * as an address the API doesn't have ("No such call", 404), like the market console's.
 *
 * Play money is exact decimal text, never a JSON number, as the books keep it; the maths' own
 * figures (sizes, prices, rates) are its numbers written out in full.
 */

/**
 * The off switch: Manifold's trading modes. On (`enabled`); closing only (`reduce-only`: no
 * opens); halted (off: no trade, no new price, no liquidation and no funding). A perp starts halted.
 */
export const tradingMode = z.enum(['enabled', 'reduce-only', 'halted']);

/** A perp is live, or (a check run's test perp, once its run is done) retired: halted for good. */
export const perpState = z.enum(['live', 'retired']);

/**
 * A perp's settings: Manifold's `PerpSettings` (product/packages/market-engine/src/perp/settings.ts),
 * each as exact text. The Bitcoin perp's are Manifold's defaults with the 10-times cap (the founder's
 * decision, 10 November 2026).
 */
export const perpSettings = z.object({
  /** The most leverage an open may ask for: 1 to 10. */
  maxLeverage: decimal,
  /** The opening fee, in basis points of the position's size (closing is free): at most 100. */
  takerFeeBps: decimal,
  /** The fee's extra for positions large beside the pool (0: the flat fee only). */
  takerFeeImpact: decimal,
  /** Time between funding payments, in milliseconds: at least an hour. */
  fundingPeriodMs: decimal,
  /** How fast funding grows with the imbalance between the sides (Manifold's k). */
  fundingSensitivity: decimal,
  /** The most funding moves in one period, as a share of the paying side's pool. */
  maxFundingRate: decimal,
  /** How old the price may be before trading pauses until the next one, in milliseconds. */
  maxPriceAgeMs: decimal,
  /** What the house put into each side's pool when the perp was made. */
  subsidyLong: decimal,
  subsidyShort: decimal,
});

/** The settings an admin may change: any of them but the subsidies, which are set when a perp is made. */
export const settingName = z.enum([
  'maxLeverage',
  'takerFeeBps',
  'takerFeeImpact',
  'fundingPeriodMs',
  'fundingSensitivity',
  'maxFundingRate',
  'maxPriceAgeMs',
]);

const account = z.object({ id: z.uuid(), email: z.string().nullable() });

/** A perp as the console shows it: what it is, its off switch, its settings, its book and money. */
export const consolePerp = z.object({
  id: recordId,
  name: z.string(),
  /** Whether it shows in the public list: the Bitcoin perp is listed; a check run's test perp isn't. */
  listed: z.boolean(),
  state: perpState,
  tradingMode,
  /** Where its price comes from: the stand-in (`stand-in-btc-usd`) until the real feed (step 3.4b). */
  feed: z.string(),
  settings: perpSettings,
  /** The last price applied to its book, and its time (the start of its 5-second step); none yet. */
  price: decimal.nullable(),
  priceAt: moment.nullable(),
  /** When its first funding period started, and when funding last ran. */
  fundingFrom: moment,
  lastFundingAt: moment.nullable(),
  /** Why trading is paused, when a price couldn't be applied without leaving the pools short. */
  pausedReason: z.string().nullable(),
  /** The play money in its two pools. */
  pools: z.object({ long: decimal, short: decimal }),
  /** The open positions' size (notional) on each side. */
  openInterest: z.object({ long: decimal, short: decimal }),
  openPositions: z.number().int().nonnegative(),
  createdAt: moment,
  updatedAt: moment,
  /** The admin who made it; null for the Bitcoin perp, which a migration made. */
  createdBy: account.nullable(),
  /** Its stand-in price's walk: where it starts, at what price, how much it moves in a year. */
  standIn: z.object({
    origin: moment,
    startPrice: decimal,
    volatility: decimal,
    /** Whether it has a seed of its own (a test perp), or uses the environment's secret one. */
    ownSeed: z.boolean(),
  }),
  /** How many steps (trades, prices, fundings) it has run. */
  steps: z.number().int().nonnegative(),
  retiredAt: moment.nullable(),
});

/** The rules a line of the rule-change log can be about. */
export const rule = z.enum([
  'created',
  'stand_in',
  'trading_mode',
  'max_leverage',
  'taker_fee_bps',
  'taker_fee_impact',
  'funding_period_ms',
  'funding_sensitivity',
  'max_funding_rate',
  'max_price_age_ms',
  'subsidy_long',
  'subsidy_short',
  'funding_from',
  'retired',
]);

/** One line of the rule-change log: a change to a perp's rules, when, who made it, and why. */
export const ruleChange = z.object({
  id: z.number().int(),
  at: moment,
  /** The admin who made it; null when a migration did (the Bitcoin perp's first rules). */
  by: account.nullable(),
  rule,
  oldValue: z.string().nullable(),
  newValue: z.string(),
  reason: z.string(),
});

export const consolePerpWithLog = consolePerp.extend({ log: z.array(ruleChange) });

/** A page of perps, newest first, and where the next page starts (null on the last). */
export const perpPage = z.object({ perps: z.array(consolePerp), next: nextCursor });

export const perpPageInput = pageInput;

export const perpIdInput = z.strictObject({ id: recordId });

/** Why a rule changes: one line, said in the log for good. */
export const reason = z
  .string()
  .trim()
  .min(1, 'Say why: every rule change is logged with its reason')
  .max(300);

/** The off switch: the mode to switch to, and why. */
export const setPerpModeInput = z.strictObject({ id: recordId, mode: tradingMode, reason });

/** A non-negative figure written as text, as the database reads it. */
const figure = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,20})?$/, 'Must be a number written as text');

/**
 * Each setting's bounds as the engine holds them (product/packages/market-engine, `assertPerpSettings`:
 * Manifold's own, with the 10-times cap), checked on the figure as the engine reads it, a JavaScript
 * number. The database holds the exact decimal to the same bounds, but a figure can round past one
 * as a number (0.99999999999999999999 is 1), and the engine would then refuse every step on the perp.
 * A check run's test perp puts at most Ṁ1,000,000 of the house's in each pool.
 */
const ENGINE_BOUNDS: Record<string, { holds: (value: number) => boolean; says: string }> = {
  maxLeverage: { holds: (n) => n >= 1 && n <= 10, says: 'From 1 to 10 times' },
  takerFeeBps: { holds: (n) => n >= 0 && n <= 100, says: 'From 0 to 100 basis points' },
  takerFeeImpact: { holds: (n) => n >= 0 && n <= 100, says: 'From 0 to 100' },
  fundingPeriodMs: {
    holds: (n) => Number.isSafeInteger(n) && n >= 3_600_000,
    says: 'Whole milliseconds, at least an hour (3,600,000)',
  },
  fundingSensitivity: { holds: (n) => n > 0, says: 'More than 0' },
  maxFundingRate: { holds: (n) => n > 0 && n < 1, says: 'More than 0 and less than 1' },
  maxPriceAgeMs: {
    holds: (n) => Number.isSafeInteger(n) && n > 0,
    says: 'Whole milliseconds, more than 0',
  },
  subsidyLong: { holds: (n) => n > 0 && n <= 1_000_000, says: 'More than 0, at most Ṁ1,000,000' },
  subsidyShort: { holds: (n) => n > 0 && n <= 1_000_000, says: 'More than 0, at most Ṁ1,000,000' },
};

/** Every setting given within the engine's bounds (`ENGINE_BOUNDS`), each refusal on its own field. */
function withinTheEngine(settings: Record<string, string | undefined>, ctx: z.RefinementCtx) {
  for (const [name, value] of Object.entries(settings)) {
    const bound = ENGINE_BOUNDS[name];
    if (value === undefined || !bound) continue;
    if (!bound.holds(Number(value)))
      ctx.addIssue({ code: 'custom', path: [name], message: bound.says });
  }
}

/**
 * A moment to the millisecond at most: a test perp's price walk starts at it, and its 5-second steps
 * are counted from it the same way in the database (microseconds) and in the engine (milliseconds).
 */
const toTheMillisecond = moment.refine(
  (value) => !/\.[0-9]{4,}/.test(value),
  'At most three digits after the seconds (milliseconds)',
);

/**
 * Some of a perp's settings, and why: at least one, each as text; the database holds each to
 * Manifold's bounds and the 10-times cap, and logs every one that changes.
 */
export const setPerpSettingsInput = z.strictObject({
  id: recordId,
  settings: z
    .strictObject({
      maxLeverage: figure.optional(),
      takerFeeBps: figure.optional(),
      takerFeeImpact: figure.optional(),
      fundingPeriodMs: figure.optional(),
      fundingSensitivity: figure.optional(),
      maxFundingRate: figure.optional(),
      maxPriceAgeMs: figure.optional(),
    })
    .refine((settings) => Object.values(settings).some((value) => value !== undefined), {
      message: 'Change at least one setting',
    })
    .superRefine(withinTheEngine),
  reason,
});

/** A stand-in price's seed: 16 hexadecimal digits, the 64-bit key of its hash. */
export const seed = z.string().regex(/^[0-9a-f]{16}$/, 'Must be 16 lowercase hexadecimal digits');

/**
 * A check run's own test perp (blueprint section 11: each run owns what it changes): unlisted, with
 * its own seed and price walk, its settings inside the same bounds as the Bitcoin perp's, and its
 * first funding period starting when it's made unless it says earlier (so a run needn't wait an hour
 * to see funding). Its ID is the caller's (a version 7 UUID), so a retried request gets back the perp
 * its first try made. It starts switched off; its pools are seeded by the house.
 */
export const createTestPerpInput = z.strictObject({
  id: recordId,
  name: z.string().trim().min(1).max(120),
  seed,
  standIn: z.strictObject({
    /** Where its walk starts: no later than now, to the millisecond at most. */
    origin: toTheMillisecond,
    startPrice: figure,
    /** How much it moves in a year: 0.55 is Bitcoin's; a test perp may move far faster, up to 100. */
    volatility: figure,
  }),
  settings: z
    .strictObject({
      maxLeverage: figure,
      takerFeeBps: figure,
      takerFeeImpact: figure,
      fundingPeriodMs: figure,
      fundingSensitivity: figure,
      maxFundingRate: figure,
      maxPriceAgeMs: figure,
      subsidyLong: figure,
      subsidyShort: figure,
    })
    .superRefine(withinTheEngine),
  fundingFrom: moment.optional(),
  reason,
});

/** Retiring a check run's test perp, once every position on it is closed: its pools back to the house. */
export const retireTestPerpInput = z.strictObject({ id: recordId, reason });

export type TradingMode = z.infer<typeof tradingMode>;
export type PerpState = z.infer<typeof perpState>;
export type PerpSettings = z.infer<typeof perpSettings>;
export type SettingName = z.infer<typeof settingName>;
export type ConsolePerp = z.infer<typeof consolePerp>;
export type RuleChange = z.infer<typeof ruleChange>;
export type ConsolePerpWithLog = z.infer<typeof consolePerpWithLog>;
export type PerpPage = z.infer<typeof perpPage>;
export type SetPerpModeInput = z.output<typeof setPerpModeInput>;
export type SetPerpSettingsInput = z.output<typeof setPerpSettingsInput>;
export type CreateTestPerpInput = z.output<typeof createTestPerpInput>;
export type RetireTestPerpInput = z.output<typeof retireTestPerpInput>;

// The perp for everyone (PLAN.md step 3.4a) --------------------------------------------------------

/** A position's side: long gains when the price rises, short when it falls. */
export const perpDirection = z.enum(['long', 'short']);

/**
 * Why a trade was refused: the engine's own reasons (PerpRefusal in
 * product/packages/market-engine/src/perp/engine.ts). Each is a 422, with the reason in its data.
 */
export const perpRefusal = z.enum([
  /** The off switch: halted (nothing trades), or closing only (no opens). */
  'trading_off',
  /** A price couldn't be applied without leaving the pools short: trading resumes with a later one. */
  'paused',
  /** The price is older than the perp allows: trading resumes with the next one. */
  'stale_price',
  /** An order fills only at a price published after it was placed. */
  'not_next_price',
  /** An amount, leverage or share that isn't valid. */
  'bad_request',
  /** More leverage than the perp allows (at most 10 times). */
  'leverage_too_high',
  /** More fee than the trader accepted, or half the margin or more. */
  'fee_too_high',
  /** The size fee can't be priced against an exhausted pool. */
  'size_fee_unpriceable',
  /** More than the person's balance (the margin and the fee). */
  'insufficient_balance',
  /** The other side can't back this much more. */
  'exposure_cap',
  /** No open position to close. */
  'no_position',
  /** A part-close sized against a position that has since moved. */
  'position_changed',
  /** The pools couldn't back this new position right now. */
  'insolvent',
]);

/** A share of play money the person sends: more than zero, to the millionth, as text. */
const amount = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/, 'Must be an amount, to the millionth')
  .refine((value) => /[1-9]/.test(value), { message: 'Must be more than zero' });

/** A position's margin: play money, at most Ṁ1,000,000 (far past any balance), to the millionth. */
const margin = amount.refine((value) => Number(value) <= 1_000_000, {
  message: 'At most Ṁ1,000,000',
});

/** A trade request's ID, chosen by whoever sends it: a retry sends the same one. */
const requestId = z.uuid('Must be a UUID, chosen by the sender and sent again on a retry');

/** Leverage: at least 1 time, as text (the perp allows at most its own cap, 10 times). */
export const leverage = z
  .string()
  .regex(/^(?:[1-9][0-9]{0,3})(?:\.[0-9]{1,4})?$/, 'Must be a leverage of at least 1, as text');

/** A share of a position to close: more than 0 and at most 1, to six decimal places. */
export const fraction = z
  .string()
  .regex(/^(?:0\.[0-9]{1,6}|1(?:\.0{1,6})?)$/, 'Must be more than 0 and at most 1, as text')
  .refine((value) => Number(value) > 0, { message: 'Must be more than 0' });

/**
 * Opening a position, or adding to the one on the same side: the margin (the person's own money)
 * and the leverage, so its size is margin times leverage; Manifold's opening fee of 10 basis points
 * of the size is charged on top. Holding the other side closes it first ("a flip"), and its payout
 * can pay for this. The order fills at the first new price published after it was placed (a new one
 * every 5 seconds), so the answer comes within seconds, never at the price on screen.
 */
export const openPerpInput = z.strictObject({
  perpId: recordId,
  requestId,
  direction: perpDirection,
  margin,
  leverage,
  /** The most fee the person accepts; needed only while a perp's size fee is on. */
  maxFee: amount.optional(),
});

/** Closing all of a position (1) or a share of it (at least 0.01), at the next new price. */
export const closePerpInput = z
  .strictObject({
    perpId: recordId,
    requestId,
    direction: perpDirection.optional(),
    fraction,
    /**
     * For a part-close, required: the size the person saw, so a position that moved since isn't cut
     * by the wrong amount (the engine's rule, Manifold's).
     */
    expectedSize: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, 'Must be a size, as text')
      .optional(),
  })
  .refine((input) => Number(input.fraction) >= 1 || input.expectedSize !== undefined, {
    message: 'Closing part of a position needs the size it was sized on',
    path: ['expectedSize'],
  });

/** A position as the person sees it. */
export const perpPosition = z.object({
  id: z.uuid(),
  perpId: recordId,
  direction: perpDirection,
  /** Its size (notional: margin times leverage, as funding and scaling have changed it). */
  size: decimal,
  /** Its margin: the person's money behind it, as funding has scaled it. */
  margin: decimal,
  entryPrice: decimal,
  leverage: decimal,
  /** Where it's liquidated: a long at or below it, a short at or above it. */
  liquidationPrice: decimal,
  /** The opening fees it has paid. */
  feesPaid: decimal,
  openedAt: moment,
  updatedAt: moment,
});

/** What a trade did, as the books wrote it. A retry of the same request answers the same. */
export const perpTradeResult = z.object({
  /** opened: a new position; added: more of one; closed: all or part of one. */
  status: z.enum(['opened', 'added', 'closed']),
  requestId: z.uuid(),
  perpId: recordId,
  /** When it was placed, and when it filled, by the database's own clock. */
  placedAt: moment,
  at: moment,
  /** The price it filled at, published after it was placed, and that price's time. */
  price: decimal,
  priceAt: moment,
  /** Play money in (margin and fee) and out (a close's or a flip's payout), exactly. */
  margin: decimal,
  fee: decimal,
  payout: decimal,
  /** The person's open position afterwards, if any, and their balance. */
  position: perpPosition.nullable(),
  balance: decimal,
});

/** A perp as anyone may see it, with its price now. */
export const perpDetails = z.object({
  id: recordId,
  name: z.string(),
  listed: z.boolean(),
  state: perpState,
  tradingMode,
  feed: z.string(),
  settings: perpSettings,
  /** The price now (the stand-in's 5-second step this moment falls in), and its time. */
  price: decimal,
  priceAt: moment,
  /** When the next price comes. */
  nextPriceAt: moment,
  /** The last price applied to its book (by a trade or the 5-second check), and its time. */
  bookPrice: decimal.nullable(),
  bookPriceAt: moment.nullable(),
  pausedReason: z.string().nullable(),
  pools: z.object({ long: decimal, short: decimal }),
  openInterest: z.object({ long: decimal, short: decimal }),
  openPositions: z.number().int().nonnegative(),
  /** The funding rate the next funding would apply now (above zero, longs pay shorts). */
  fundingRate: decimal,
  lastFundingAt: moment.nullable(),
  nextFundingAt: moment,
});

/** The listed perps (the Bitcoin perp). */
export const perpList = z.object({ perps: z.array(perpDetails) });

export const perpAddress = z.strictObject({ id: recordId });

/** One of the person's open positions, with what it's worth at the price now. */
export const heldPerpPosition = perpPosition.extend({
  perpName: z.string(),
  tradingMode,
  /** The price now, and the position's value and profit (or loss) at it; null if not priced here. */
  price: decimal.nullable(),
  value: decimal.nullable(),
  profit: decimal.nullable(),
});

/** The person's balance, and a page of their open positions, newest first. */
export const perpPositionsPage = z.object({
  balance: decimal,
  positions: z.array(heldPerpPosition),
  next: nextCursor,
});

export const perpPositionsPageInput = pageInput;

/** The errors a perp's trading call may answer, besides a refused input (400, BAD_REQUEST). */
export const perpTradingErrors = {
  UNAUTHORIZED: { status: 401, message: 'Not signed in' },
  /** A read-only API key: only a trading key may trade. */
  FORBIDDEN: forbidden,
  NOT_FOUND: { status: 404, message: 'No such perp' },
  CONFLICT: {
    status: 409,
    message: 'This request ID was already used for a different request',
  },
  REFUSED: {
    status: 422,
    message: 'The trade was refused',
    data: z.object({ reason: perpRefusal }),
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Too many trades: try again in a moment',
    data: z.object({ retryAfterSeconds: z.number().int().positive() }),
  },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Try again in a moment' },
} as const;

export type PerpDirection = z.infer<typeof perpDirection>;
export type PerpRefusal = z.infer<typeof perpRefusal>;
export type OpenPerpInput = z.output<typeof openPerpInput>;
export type ClosePerpInput = z.output<typeof closePerpInput>;
export type PerpPosition = z.infer<typeof perpPosition>;
export type PerpTradeResult = z.infer<typeof perpTradeResult>;
export type PerpDetails = z.infer<typeof perpDetails>;
export type PerpList = z.infer<typeof perpList>;
export type HeldPerpPosition = z.infer<typeof heldPerpPosition>;
export type PerpPositionsPage = z.infer<typeof perpPositionsPage>;
