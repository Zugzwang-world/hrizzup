import { answerOf } from '../shape.ts';
import { step as counts } from './steps/counts.ts';
import { step as purge } from './steps/purge.ts';
import { step as recount } from './steps/recount.ts';
import { step as stories } from './steps/stories.ts';
import {
  type JobDeps,
  mergeIds,
  noIds,
  type Step,
  type StepAnswer,
  type StepName,
} from './types.ts';

/**
 * The minute job (docs/social/build.md, D7 and section 7.2), run by the jobs' door
 * (`app/api/jobs/social`, R5) once a minute through Supabase Cron:
 *
 * 1. `social.job_begin('minute', 55)` takes the job's lease; with none free another run holds it, and
 *    this one answers `busy` and does nothing;
 * 2. the steps run in order, each from its own file under `steps/` (stories, counts, recount, purge):
 *    each is given the window's start and every ID the steps before it changed, and the IDs it answers
 *    join them, so the recount recounts everything an earlier step touched;
 * 3. `social.job_end` closes the lease with the summary (IDs and counts only), kept in
 *    `job_runs.last_summary` and answered to pg_net. A step that fails stops the run, and the run ends
 *    unhealthy (`ok: false`): the good run's mark doesn't move, so the next run's window covers the gap.
 *
 * What is answered names a failed step and nothing else of the failure (never an error's text: it goes
 * to the log, by name and code).
 */

/** The steps, in their order. */
export const STEPS: readonly Step[] = [stories, counts, recount, purge];

/** The lease: a run of 60 seconds at most (the door's `maxDuration`), so 55 leaves it room to end. */
export const LEASE_SECONDS = 55;

/** What a run answers. */
export type MinuteAnswer =
  | { ran: false; busy: true }
  | {
      ran: true;
      /** Whether every step went through: the door answers 200, and 500 when not. */
      ok: boolean;
      runId: string;
      /** Each step that ran, with what its summary says. */
      steps: Partial<Record<StepName, Record<string, unknown>>>;
      /** The step that failed, when one did: the steps after it didn't run. */
      failed?: StepName;
    };

/** The lease's start: what `job_begin` answered, or null when no lease was free. */
async function begin(deps: JobDeps): Promise<{ runId: string; since: string } | null> {
  const begun = await deps.run(async (tx) =>
    answerOf(
      (await tx.query('select social.job_begin($1, $2) as answer', ['minute', LEASE_SECONDS])).rows,
    ),
  );
  if (begun === null || begun === undefined) return null;
  const { run, since } = begun as { run?: unknown; since?: unknown };
  if (typeof run !== 'string' || typeof since !== 'string') {
    throw new TypeError("The database's answer to job_begin isn't {run, since}");
  }
  return { runId: run, since };
}

/** Runs the minute job once. Throws only when the lease itself can't be taken or closed. */
export async function runMinute(
  deps: JobDeps,
  steps: readonly Step[] = STEPS,
): Promise<MinuteAnswer> {
  const lease = await begin(deps);
  if (lease === null) return { ran: false, busy: true };

  let also = noIds();
  const earlier: Partial<Record<StepName, StepAnswer>> = {};
  const summary: Partial<Record<StepName, Record<string, unknown>>> = {};
  let failed: StepName | undefined;

  for (const step of steps) {
    try {
      const answer = await step.run({
        ...deps,
        runId: lease.runId,
        since: lease.since,
        also,
        earlier,
      });
      earlier[step.name] = answer;
      also = mergeIds(also, answer.ids ?? {});
      summary[step.name] = answer.summary ?? {};
    } catch (error) {
      failed = step.name;
      summary[step.name] = { failed: true };
      // The log gets the step and the error's name and code, never its text, which may quote data.
      const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
      console.error('social minute job: a step failed', { step: step.name, name, code });
      break;
    }
  }

  const ok = failed === undefined;
  await deps.run((tx) =>
    tx.query('select social.job_end($1, $2, $3, $4::jsonb)', [
      'minute',
      lease.runId,
      ok,
      JSON.stringify(summary),
    ]),
  );
  return { ran: true, ok, runId: lease.runId, steps: summary, ...(failed ? { failed } : {}) };
}
