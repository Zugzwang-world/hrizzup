import type { Run } from '../access.ts';

/**
 * The minute run's time (R5's design note, R5 and M2 rule 1; docs/social/build.md, 7.2).
 *
 * Supabase Cron's call (`social._call_job`, through pg_net) gives up after 25 seconds with no status at
 * all, which `social_setup.py check --jobs` reports as a failed call and an operator can't read a cause
 * from. So the whole run is planned to fit well inside that, every part with its own limit:
 *
 * - **Each database call is limited by the database itself** (`statement_timeout` and `lock_timeout`,
 *   which `@hrizzup/db`'s `transaction` sets first thing inside each transaction from the limits a
 *   caller passes to `Run`): the lease's two calls the frame's, each step its own. `asJob`'s own 30
 *   seconds outlives pg_net, so none of them is left to it.
 * - **The purge waits a bounded time** for the edge, and Redis a bounded time (`cache.ts`'s
 *   `REDIS_TIMEOUT_MS`, 500 ms: a read or delete that Redis doesn't answer by then is given up).
 * - **The door answers by its deadline regardless** (`DEADLINE_MS`), so a hung connection shows as a
 *   late run, never as pg_net's empty status. The run itself carries on under `waitUntil`, so it still
 *   closes its lease (the lease is 55 seconds, the door's `maxDuration` 60).
 *
 * The plan below is a sum of limits, each counted once: `transaction` tries a statement again when a
 * lock wait runs out (up to three attempts in all), which `Run` doesn't let a caller turn off, so a
 * step that finds a lock held can take up to that long again. The deadline above is what keeps the
 * answer inside pg_net's time then, not this sum.
 */

/** A database call's limits, in milliseconds, as `Run` takes them. */
export type Limits = { statementTimeoutMs: number; lockTimeoutMs: number };

/** What the lease's two calls (`job_begin`, `job_end`) are given: the frame's own limits. */
export const FRAME: Limits = { statementTimeoutMs: 2_000, lockTimeoutMs: 1_000 };

/** The stories step: it lists and moves rows for the stories saved since the window began. */
export const STORIES: Limits = { statementTimeoutMs: 3_000, lockTimeoutMs: 1_000 };

/** The recount step: exact counts and ranks for everything touched (it may recount many rows). */
export const RECOUNT: Limits = { statementTimeoutMs: 5_000, lockTimeoutMs: 1_000 };

/** Time kept for R11's counts step (it takes Redis's counters and applies them in one statement). */
export const COUNTS_RESERVE_MS = 3_000;

/** The longest the purge waits for the edge's purge calls to finish. */
export const PURGE_WAIT_MS = 2_000;

/** The longest a Redis read or delete waits (`cache.ts`), counted once for the purge's brief delete. */
export const REDIS_WAIT_MS = 500;

/** The door answers by this time, run finished or not. */
export const DEADLINE_MS = 18_000;

/**
 * What pg_net waits for the door's answer: `timeout_milliseconds` in `social._call_job` (a migration that is
 * on `main` never changes, so this number is written here, not read from it).
 */
export const PG_NET_TIMEOUT_MS = 25_000;

/**
 * Every part of a run, one after another: the lease's start, the stories step, the counts reserve,
 * the recount, the purge's brief delete and its wait for the edge, the lease's end.
 */
export const PLANNED_MS =
  FRAME.statementTimeoutMs +
  STORIES.statementTimeoutMs +
  COUNTS_RESERVE_MS +
  RECOUNT.statementTimeoutMs +
  REDIS_WAIT_MS +
  PURGE_WAIT_MS +
  FRAME.statementTimeoutMs;

/**
 * `run` with the frame's limits under whatever a caller sends: the lease's two calls (`minute.ts`
 * passes none) get the frame's, and a step's own limits win over them.
 */
export function framed(run: Run): Run {
  return (work, limits) => run(work, { ...FRAME, ...limits });
}
