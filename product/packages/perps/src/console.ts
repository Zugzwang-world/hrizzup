import type {
  ConsolePerp,
  ConsolePerpWithLog,
  CreateTestPerpInput,
  PerpPage,
  RetireTestPerpInput,
  SetPerpModeInput,
  SetPerpSettingsInput,
} from '@hrizzup/api';
import { type Transaction, transaction } from '@hrizzup/db';
import { asConsoleError, ConsoleError } from '@hrizzup/markets';
import type { Pool } from 'pg';

/**
 * The perp's console (PLAN.md step 3.4a; blueprint sections 5 and 13): the off switch (Manifold's
 * trading modes: on, closing only, halted), the settings and the rule-change log, and a check run's
 * own unlisted test perps, made and retired. Each call is one database transaction through the
 * server's one database helper (`@hrizzup/db`), as the app's own role with the signed-in account
 * set, calling the database's own functions in schema `admin`: they check the admins table before
 * anything else and log every rule change with its reason, so the database itself refuses anyone but
 * an admin, whatever the server code does.
 *
 * What the database refuses comes back as a `ConsoleError` (from `@hrizzup/markets`, the same as the
 * market console's), by kind; `DatabaseBusyError` (from `@hrizzup/db`) means "try again".
 */

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

/** The database's perp, as the contract has it (it already writes the contract's names). */
const asPerp = (row: ConsolePerp): ConsolePerp => row;
const asPerpWithLog = (row: ConsolePerpWithLog): ConsolePerpWithLog => ({
  ...row,
  log: row.log ?? [],
});

/** Perps, newest first, `max` at a time (1 to 100), after the perp `after`. */
export function listPerps(
  pool: Database,
  account: string,
  page: { after?: string | undefined; max?: number } = {},
): Promise<PerpPage> {
  return call(pool, account, async (tx) => {
    const found = await answer<{ perps: ConsolePerp[]; next: string | null }>(
      tx,
      'select admin.perps($1, $2) as answer',
      [page.after ?? null, page.max ?? 50],
    );
    return { perps: found.perps.map(asPerp), next: found.next };
  });
}

/** One perp, with its rule-change log, oldest line first. */
export function getPerp(pool: Database, account: string, id: string): Promise<ConsolePerpWithLog> {
  return call(pool, account, async (tx) =>
    asPerpWithLog(await answer(tx, 'select admin.perp($1) as answer', [id])),
  );
}

/** The off switch, at once (after any step in flight on the perp), with the reason in the log. */
export function setPerpMode(
  pool: Database,
  account: string,
  input: SetPerpModeInput,
): Promise<ConsolePerpWithLog> {
  return call(pool, account, async (tx) =>
    asPerpWithLog(
      await answer(tx, 'select admin.set_perp_mode($1, $2, $3) as answer', [
        input.id,
        input.mode,
        input.reason,
      ]),
    ),
  );
}

/** Some of a perp's settings, each change in the log with the reason. */
export function setPerpSettings(
  pool: Database,
  account: string,
  input: SetPerpSettingsInput,
): Promise<ConsolePerpWithLog> {
  const settings = Object.fromEntries(
    Object.entries(input.settings).filter(([, value]) => value !== undefined),
  );
  return call(pool, account, async (tx) =>
    asPerpWithLog(
      await answer(tx, 'select admin.set_perp_settings($1, $2, $3) as answer', [
        input.id,
        settings,
        input.reason,
      ]),
    ),
  );
}

/** A check run's own unlisted test perp, switched off, its pools seeded by the house. */
export function createTestPerp(
  pool: Database,
  account: string,
  input: CreateTestPerpInput,
): Promise<ConsolePerpWithLog> {
  return call(pool, account, async (tx) =>
    asPerpWithLog(
      await answer(tx, 'select admin.create_test_perp($1, $2, $3, $4, $5, $6, $7) as answer', [
        input.id,
        input.name,
        input.seed,
        input.standIn,
        input.settings,
        input.fundingFrom ?? null,
        input.reason,
      ]),
    ),
  );
}

/**
 * Retires a test perp once every position on it is closed: halted for good, its pools to the house.
 * Asked again once it's retired (a retried request, or a check run's cleanup), it answers with the
 * retired perp, as a retried create answers with the perp its first try made; everything else the
 * database refuses (the listed perp, an open position) stays refused.
 */
export async function retireTestPerp(
  pool: Database,
  account: string,
  input: RetireTestPerpInput,
): Promise<ConsolePerpWithLog> {
  try {
    return await call(pool, account, async (tx) =>
      asPerpWithLog(
        await answer(tx, 'select admin.retire_test_perp($1, $2) as answer', [
          input.id,
          input.reason,
        ]),
      ),
    );
  } catch (error) {
    if (!(error instanceof ConsoleError) || error.kind !== 'conflict') throw error;
    const now = await getPerp(pool, account, input.id);
    if (now.state === 'retired') return now;
    throw error;
  }
}
