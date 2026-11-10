import { parts, validate } from '@hrizzup/agreement';
import { z } from 'zod';

/**
 * The market console's part of the contract (PLAN.md step 1.7c; blueprint section 13): what an
 * admin sends to create, open, close and settle a market, and the market and its log as the
 * console shows them. Only admins may make these calls; to everyone else, signed in or not, they
 * answer exactly as an address the API doesn't have ("No such call", 404).
 */

/** A record's ID, as the agreement's records have: a version 7 UUID, in lower case. */
export const recordId = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'Must be a version 7 UUID, in lower case',
  );

type CategoryList = { $defs: { category: { oneOf: { const: string; title: string }[] } } };

/** The categories in the agreement's shared list, in its order, with the names people see. */
export const categories: readonly { code: string; name: string }[] = (
  parts[1] as unknown as CategoryList
).$defs.category.oneOf.map((item) => ({ code: item.const, name: item.title }));

const category = z.enum(categories.map((c) => c.code) as [string, ...string[]]);

/** An exact amount or probability, written as text, as the database keeps it. */
export const decimal = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, 'Must be an exact decimal');

/** A moment, as the agreement writes one: UTC, in ISO 8601 (`2026-11-09T06:30:00Z`). */
export const moment = z.iso.datetime();

/**
 * A probability a market starts at, is settled at, or a limit order buys up to: 1% to 99%, to at
 * most 8 decimal places.
 */
export const probability = z
  .string()
  .regex(/^0\.[0-9]{1,8}$/, 'Must be a decimal from 0.01 to 0.99')
  .refine((value) => Number(value) >= 0.01 && Number(value) <= 0.99, {
    message: 'Must be from 0.01 to 0.99',
  });

/** What the house seeds a market with: more than Ṁ0 and at most Ṁ1,000,000, to the millionth. */
const seed = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$/, 'Must be an amount, to the millionth')
  .refine((value) => Number(value) > 0 && Number(value) <= 1_000_000, {
    message: 'Must be more than 0 and at most 1,000,000',
  });

export const outcome = z.enum(['yes', 'no', 'probability', 'cancel']);
export const marketState = z.enum(['draft', 'open', 'closed', 'settled', 'cancelled']);

const account = z.object({ id: z.uuid(), email: z.string().nullable() });

/** A market as the console shows it: the agreement's fields, its trading state and its money. */
export const consoleMarket = z.object({
  id: recordId,
  question: z.string(),
  categories: z.array(z.string()),
  kind: z.enum(['yes_no', 'multiple_choice']),
  rules: z.string(),
  source: z.object({ name: z.string(), url: z.string().optional() }),
  settlement: z.enum(['by_hand', 'automatic']),
  opensAt: moment,
  closesAt: moment,
  state: marketState,
  /** How it was settled, once it has been: the outcome, a set probability, a cancel's reason. */
  result: z
    .object({
      outcome,
      probability: decimal.nullable(),
      cancelReason: z.string().nullable(),
      at: moment,
    })
    .nullable(),
  createdAt: moment,
  updatedAt: moment,
  createdBy: account,
  /** The probability the house's seed opens it at. */
  startingProbability: decimal,
  /** What the house puts in when it opens. */
  seed: decimal,
  /** The pool's Yes and No shares (none while it's a draft). */
  pool: z.object({ yes: decimal, no: decimal }),
  /** The probability its pool shows now, while it's open or closed. */
  probability: decimal.nullable(),
  /** The play money the market holds now: nothing once settled. */
  held: decimal,
  trades: z.number().int().nonnegative(),
  /**
   * Whether it shows in the public list (`markets.list`). An unlisted market is traded and settled
   * like any other, by its address, but never listed, as on Manifold; the checks' test markets are
   * unlisted. Chosen when it's made, never changed after.
   */
  listed: z.boolean(),
});

/** One line of a market's log: who did what and when; for a settlement, how, why and what it paid. */
export const consoleLogLine = z.object({
  id: z.number().int(),
  action: z.enum(['create', 'open', 'close', 'settle']),
  at: moment,
  by: account,
  settlement: z
    .object({
      outcome,
      probability: decimal.nullable(),
      evidence: z.string(),
      reason: z.string().nullable(),
      /** What people got, net: a cancel takes back sale profits, so it can be below zero. */
      paidToPeople: decimal,
      people: z.number().int().nonnegative(),
      /** What the house got: with what people got, all the market held. */
      toHouse: decimal,
    })
    .nullable(),
});

export const consoleMarketWithLog = consoleMarket.extend({ log: z.array(consoleLogLine) });

/** A page of markets, newest first, and where the next page starts (null on the last). */
export const marketPage = z.object({ markets: z.array(consoleMarket), next: recordId.nullable() });

export const marketPageInput = z.strictObject({ after: recordId.optional() }).optional();

export const marketIdInput = z.strictObject({ id: recordId });

/** The fields the agreement names differently from the contract. */
const FIELD_NAMES: Record<string, string> = { opens_at: 'opensAt', closes_at: 'closesAt' };

/**
 * A new market, as a draft. Its ID is the caller's to choose (a version 7 UUID), so a retried
 * request gets back the market its first try made. Every rule the agreement has for a market is
 * checked by the agreement's own check, `validate()`, on the draft record it will be.
 */
export const createMarketInput = z
  .strictObject({
    id: recordId,
    question: z.string(),
    categories: z.array(category).min(1).max(3),
    rules: z.string(),
    source: z.strictObject({ name: z.string(), url: z.string().optional() }),
    opensAt: moment,
    closesAt: moment,
    probability: probability.default('0.5'),
    seed: seed.default('1000'),
    /** Whether it shows in the public list: yes unless asked otherwise (a test market). */
    listed: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    const now = new Date().toISOString();
    const draft = {
      format: 'market/1',
      id: input.id,
      question: input.question,
      categories: input.categories,
      kind: 'yes_no',
      rules: input.rules,
      source: input.source,
      settlement: 'by_hand',
      opens_at: input.opensAt,
      closes_at: input.closesAt,
      state: 'draft',
      created_at: now,
      updated_at: now,
    };
    for (const problem of validate(draft)) {
      const path = problem.path
        .split('/')
        .filter(Boolean)
        .map((part) => FIELD_NAMES[part] ?? part);
      ctx.addIssue({ code: 'custom', message: problem.message, path });
    }
    if (Date.parse(input.closesAt) <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        message: 'A market closes in the future',
        path: ['closesAt'],
      });
    }
    if (Date.parse(input.opensAt) >= Date.parse(input.closesAt)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A market opens before it closes',
        path: ['opensAt'],
      });
    }
  });

/**
 * Settling a closed market: Yes, No, a set probability, or cancel (only when it can't be settled
 * fairly). Every settlement gives its evidence, and a cancel its reason.
 */
export const settleMarketInput = z
  .strictObject({
    id: recordId,
    outcome,
    probability: probability.optional(),
    evidence: z.string().min(1).max(2000),
    reason: z.string().min(1).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.outcome === 'probability') !== (input.probability !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A set probability, and only a set probability, gives a probability',
        path: ['probability'],
      });
    }
    if ((input.outcome === 'cancel') !== (input.reason !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A cancel, and only a cancel, gives its reason',
        path: ['reason'],
      });
    }
  });

export type ConsoleMarket = z.infer<typeof consoleMarket>;
export type ConsoleLogLine = z.infer<typeof consoleLogLine>;
export type ConsoleMarketWithLog = z.infer<typeof consoleMarketWithLog>;
export type MarketPage = z.infer<typeof marketPage>;
export type CreateMarketInput = z.output<typeof createMarketInput>;
export type SettleMarketInput = z.output<typeof settleMarketInput>;
export type Outcome = z.infer<typeof outcome>;
export type MarketState = z.infer<typeof marketState>;
