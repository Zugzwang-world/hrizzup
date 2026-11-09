import type {
  ConsoleLogLine,
  ConsoleMarket,
  ConsoleMarketWithLog,
  CreateMarketInput,
  MarketPage,
  Outcome,
  SettleMarketInput,
} from '@hrizzup/api';
import { errorCode, type Transaction, transaction } from '@hrizzup/db';
import type { Pool } from 'pg';

/**
 * The market console's calls (PLAN.md step 1.7c; blueprint sections 5 and 13): create, open,
 * close and settle a market, and the reads the console shows. Each is one database transaction,
 * through the server's one database helper (`@hrizzup/db`), as the app's own role with the
 * signed-in account set, calling the database's own functions in schema `admin`. Those check the
 * admins table before anything else and write the market log, so the database itself refuses
 * anyone but an admin, whatever the server code does. Settling runs the ledger's settlement in
 * the same transaction.
 *
 * What the database refuses comes back as a ConsoleError, by kind; `DatabaseBusyError` (from
 * `@hrizzup/db`) means "try again".
 */

/** Why the console's call was refused. */
export type ConsoleRefusal =
  /** The signed-in account isn't an admin, or nobody is signed in. */
  | 'not_admin'
  /** No market has that ID. */
  | 'not_found'
  /** The market isn't in a state that allows it (opening an open market, settling an open one). */
  | 'conflict'
  /** What was sent breaks a rule (the agreement's, or the market's). */
  | 'invalid';

export class ConsoleError extends Error {
  constructor(
    readonly kind: ConsoleRefusal,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConsoleError';
  }
}

/** The database's refusals, by their SQLSTATE codes, as the console's own. */
const REFUSALS: Record<string, ConsoleRefusal> = {
  '42501': 'not_admin', // insufficient_privilege: private.signed_in_admin()
  P0002: 'not_found', // no_data_found
  '55000': 'conflict', // object_not_in_prerequisite_state: the market's state
  '0A000': 'conflict', // feature_not_supported: only a yes-or-no market opens for now
  '22023': 'invalid', // invalid_parameter_value: the call's own checks
  '23514': 'invalid', // check_violation: the agreement's rules as database rules
  '23505': 'invalid', // unique_violation: a market ID already used for another market
  '22P02': 'invalid', // invalid_text_representation: a value the database can't read
  '22007': 'invalid', // invalid_datetime_format
  '22008': 'invalid', // datetime_field_overflow
};

/** What people see for a rule the database's own building blocks hold (their constraint names). */
const RULES: Record<string, string> = {
  one_line_pattern: 'Must be one line of plain text, with no spaces at either end',
  one_line_code_checks: 'Must be plain text, with no hidden characters',
  plain_text_pattern: 'Must be plain text, with no spaces or new lines at either end',
  plain_text_code_checks: 'Must be plain text, with no hidden characters',
  web_address_pattern: 'Must be a web address starting https://',
  web_address_characters: 'Must be a web address, in the characters one can hold',
  log_evidence_length: 'The evidence is at most 2,000 characters',
  log_reason_length: "A cancel's reason is at most 200 characters",
};

/** A database refusal as a ConsoleError, or the error as it was. */
export function asConsoleError(error: unknown): unknown {
  const code = errorCode(error);
  const kind = code === undefined ? undefined : REFUSALS[code];
  if (!kind) return error;
  if (kind === 'not_admin')
    return new ConsoleError(kind, 'Only an admin may do this', { cause: error });
  const constraint = (error as { constraint?: unknown }).constraint;
  const message =
    (typeof constraint === 'string' ? RULES[constraint] : undefined) ??
    (error instanceof Error ? error.message : 'Refused');
  return new ConsoleError(kind, message, { cause: error });
}

/** A database row's settlement outcome, from the ledger's resolution. */
const OUTCOMES: Record<string, Outcome> = {
  YES: 'yes',
  NO: 'no',
  MKT: 'probability',
  CANCEL: 'cancel',
};

type Account = { id: string; email: string | null };

/** A market as `markets.console_view()` gives it. */
type MarketRow = {
  id: string;
  question: string;
  categories: string[];
  kind: 'yes_no' | 'multiple_choice';
  rules: string;
  source: { name: string; url?: string };
  settlement: 'by_hand' | 'automatic';
  opens_at: string;
  closes_at: string;
  state: ConsoleMarket['state'];
  resolution: 'YES' | 'NO' | 'MKT' | 'CANCEL' | null;
  resolution_probability: string | null;
  cancel_reason: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: Account;
  starting_probability: string;
  seed: string;
  pool: { yes: string; no: string };
  probability: string | null;
  held: string;
  trades: number;
  log: LogRow[] | null;
};

type LogRow = {
  id: number;
  action: ConsoleLogLine['action'];
  at: string;
  by: Account;
  outcome: Outcome | null;
  probability: string | null;
  evidence: string | null;
  reason: string | null;
  paid_to_people: string | null;
  people: number | null;
  to_house: string | null;
};

function toMarket(row: MarketRow): ConsoleMarket {
  return {
    id: row.id,
    question: row.question,
    categories: row.categories,
    kind: row.kind,
    rules: row.rules,
    source: row.source,
    settlement: row.settlement,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    state: row.state,
    result:
      row.resolution && row.settled_at
        ? {
            outcome: OUTCOMES[row.resolution] as Outcome,
            probability: row.resolution_probability,
            cancelReason: row.cancel_reason,
            at: row.settled_at,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    startingProbability: row.starting_probability,
    seed: row.seed,
    pool: row.pool,
    probability: row.probability,
    held: row.held,
    trades: row.trades,
  };
}

function toLogLine(row: LogRow): ConsoleLogLine {
  return {
    id: row.id,
    action: row.action,
    at: row.at,
    by: row.by,
    settlement:
      row.action === 'settle' && row.outcome
        ? {
            outcome: row.outcome,
            probability: row.probability,
            evidence: row.evidence ?? '',
            reason: row.reason,
            paidToPeople: row.paid_to_people ?? '0',
            people: row.people ?? 0,
            toHouse: row.to_house ?? '0',
          }
        : null,
  };
}

function toMarketWithLog(row: MarketRow): ConsoleMarketWithLog {
  return { ...toMarket(row), log: (row.log ?? []).map(toLogLine) };
}

type Database = Pick<Pool, 'connect'>;

/** One of the console's calls, as one transaction for the signed-in `account`. */
async function call<T>(
  pool: Database,
  account: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await transaction(pool, work, { account });
  } catch (error) {
    throw asConsoleError(error);
  }
}

async function answer<R>(tx: Transaction, sql: string, values: unknown[]): Promise<R> {
  const { rows } = await tx.query<{ answer: R }>(sql, values);
  const row = rows[0];
  if (!row) throw new Error('The database answered nothing');
  return row.answer;
}

/** Whether the signed-in account is an admin: what the console asks before it shows anything. */
export function isAdmin(pool: Database, account: string): Promise<boolean> {
  return call(pool, account, (tx) => answer<boolean>(tx, 'select admin.is_admin() as answer', []));
}

/** Markets, newest first, `max` at a time (1 to 100), after the market `after`. */
export function listMarkets(
  pool: Database,
  account: string,
  page: { after?: string | undefined; max?: number } = {},
): Promise<MarketPage> {
  return call(pool, account, async (tx) => {
    const found = await answer<{ markets: MarketRow[]; next: string | null }>(
      tx,
      'select admin.markets($1, $2) as answer',
      [page.after ?? null, page.max ?? 50],
    );
    return { markets: found.markets.map(toMarket), next: found.next };
  });
}

/** One market, with its log. */
export function getMarket(
  pool: Database,
  account: string,
  id: string,
): Promise<ConsoleMarketWithLog> {
  return call(pool, account, async (tx) =>
    toMarketWithLog(await answer<MarketRow>(tx, 'select admin.market($1) as answer', [id])),
  );
}

/** A new yes-or-no market, as a draft; the same ID again gets back the market it made. */
export function createMarket(
  pool: Database,
  account: string,
  input: CreateMarketInput,
): Promise<ConsoleMarketWithLog> {
  return call(pool, account, async (tx) =>
    toMarketWithLog(
      await answer<MarketRow>(
        tx,
        'select admin.create_market($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as answer',
        [
          input.id,
          input.question,
          input.categories,
          input.rules,
          input.source.name,
          input.source.url ?? null,
          input.opensAt,
          input.closesAt,
          input.probability,
          input.seed,
        ],
      ),
    ),
  );
}

/** Opens a draft: betting starts at once, and the house seeds its pool. */
export function openMarket(
  pool: Database,
  account: string,
  id: string,
): Promise<ConsoleMarketWithLog> {
  return call(pool, account, async (tx) =>
    toMarketWithLog(await answer<MarketRow>(tx, 'select admin.open_market($1) as answer', [id])),
  );
}

/** Closes an open market: betting stops at once. */
export function closeMarket(
  pool: Database,
  account: string,
  id: string,
): Promise<ConsoleMarketWithLog> {
  return call(pool, account, async (tx) =>
    toMarketWithLog(await answer<MarketRow>(tx, 'select admin.close_market($1) as answer', [id])),
  );
}

/** Settles a closed market by hand, with its evidence: Yes, No, a set probability, or cancel. */
export function settleMarket(
  pool: Database,
  account: string,
  input: SettleMarketInput,
): Promise<ConsoleMarketWithLog> {
  return call(pool, account, async (tx) =>
    toMarketWithLog(
      await answer<MarketRow>(tx, 'select admin.settle_market($1, $2, $3, $4, $5) as answer', [
        input.id,
        input.outcome,
        input.probability ?? null,
        input.evidence,
        input.reason ?? null,
      ]),
    ),
  );
}
