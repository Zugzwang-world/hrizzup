import { z } from 'zod';

/**
 * The public API's ground rules (PLAN.md step 3.5a; docs/research/public-api.md, sections 2.4 to
 * 2.6), kept in one place so every call follows them:
 *
 * - **One way to page through every list:** `limit` (1 to 100, 50 when not sent) and `cursor`, the
 *   `next` of the page before, sent back exactly as it came. Every page answers its `next`, null on
 *   the last page. A cursor is opaque: what's inside it may change, so a bot never builds one.
 * - **One error format:** every refusal answers `{ defined, code, status, message, data }`, as
 *   oRPC writes it, with the call's own errors in the contract. A refused input is always 400
 *   `BAD_REQUEST`, with each problem in `data.issues` (its field's path and what's wrong).
 */

/** Where a page starts: the `next` of the page before, sent back exactly as it came. */
export const cursor = z
  .string()
  .min(1)
  .max(200)
  .describe('Where the page starts: the `next` of the page before, sent back exactly as it came');

/** The most a page holds. */
export const MOST_A_PAGE = 100;
/** What a page holds when `limit` isn't sent. */
export const DEFAULT_PAGE = 50;

/** How many to a page: 1 to 100 (50 when not sent). Written in an address, so taken as text too. */
export const pageLimit = z.coerce
  .number<number>()
  .int('Must be a whole number')
  .min(1, 'Must be at least 1')
  .max(MOST_A_PAGE, `Must be at most ${MOST_A_PAGE}`)
  .describe(`How many to a page: 1 to ${MOST_A_PAGE} (${DEFAULT_PAGE} when not sent)`);

/**
 * A page's two fields, the same in every list: where it starts, and how many to a page. A list of
 * one thing's own (a market's trades) takes them beside that thing's address.
 */
export const pageFields = { cursor: cursor.optional(), limit: pageLimit.optional() };

/** A list's input: where the page starts, and how many to a page. Neither is needed. */
export const pageInput = z.strictObject(pageFields).optional();

/** Where the next page starts: send it as `cursor`. Null on the last page. */
export const nextCursor = z
  .string()
  .nullable()
  .describe('Where the next page starts: send it back as `cursor`. Null on the last page');

/** One problem with a refused input: the field's path (`marketId`, `source.name`; empty for the whole input) and what's wrong. */
export const issue = z.object({ path: z.string(), message: z.string() });

/** The errors every call may answer. */
export const commonErrors = {
  /** The input was refused: each problem in `data.issues`. */
  BAD_REQUEST: {
    status: 400,
    message: 'The request was refused: see data.issues',
    data: z.object({ issues: z.array(issue) }),
  },
  /** The database or a service behind the API is busy or not set up: try again in a moment. */
  SERVICE_UNAVAILABLE: { status: 503, message: 'Try again in a moment' },
} as const;

export type PageInput = z.output<typeof pageInput>;
export type Issue = z.infer<typeof issue>;
