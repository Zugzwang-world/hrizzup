import { transaction } from '@hrizzup/db';
import type { Pool } from 'pg';
import { PerpNotSetUpError, type PriceSource, runStep } from './step.ts';

/**
 * The perp's scheduled jobs (PLAN.md step 3.4a), which Supabase Cron starts (defined in a migration):
 * every 5 seconds the next stand-in price, with the liquidation check (`tick`); every hour the
 * funding (`funding`). They run the same steps as trades, with the same engine code: never a second
 * copy of the maths. Each step happens once even if runs overlap: a price is applied once a 5-second
 * step (the database refuses it twice), funding once a period, and a tick skips a perp another step
 * holds (that step applies the same price). Nothing runs on a perp switched off: the database lists
 * only the perps with work (`perps.due`), and refuses any step on one that's halted.
 */

type Database = Pick<Pool, 'connect'>;

export type JobName = 'tick' | 'funding';

/** What one run of a job did, perp by perp. */
export type JobRun = {
  job: JobName;
  /** The perps it had work on. */
  perps: number;
  /** Steps it wrote (a price applied, a funding paid). */
  applied: number;
  /** Perps another step held, which did the same work. */
  busy: number;
  /** Perps with nothing to write this time (no new price yet, funding not due). */
  nothing: number;
  /** Perps whose price isn't set up here (no seed for the listed perp). */
  notSetUp: number;
  /** Perps whose step failed: each is tried again on the job's next run. */
  failed: { perpId: string; error: string }[];
  liquidations: number;
};

/** The perps a job has work on now: live, not switched off, with an open position (and funding due). */
async function due(pool: Database, job: JobName): Promise<string[]> {
  return transaction(
    pool,
    async (tx) => {
      const { rows } = await tx.query<{ ids: string[] }>('select perps.due($1) as ids', [job]);
      return rows[0]?.ids ?? [];
    },
    { account: null },
  );
}

/** One run of a job: a step on every perp it has work on, each its own transaction. */
export async function runJob(pool: Database, job: JobName, source: PriceSource): Promise<JobRun> {
  const run: JobRun = {
    job,
    perps: 0,
    applied: 0,
    busy: 0,
    nothing: 0,
    notSetUp: 0,
    failed: [],
    liquidations: 0,
  };
  const perps = await due(pool, job);
  run.perps = perps.length;
  for (const perpId of perps) {
    try {
      const answer = await runStep(pool, null, perpId, { action: job }, source);
      if (answer.kind === 'applied') {
        run.applied += 1;
        run.liquidations += Number(answer.result.liquidations ?? 0);
      } else if (answer.kind === 'busy') run.busy += 1;
      else run.nothing += 1;
    } catch (error) {
      if (error instanceof PerpNotSetUpError) run.notSetUp += 1;
      else
        run.failed.push({ perpId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return run;
}
