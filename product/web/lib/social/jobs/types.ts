import { asJob, pool, type Run } from '../access.ts';
import { type SocialCache, socialCache } from '../cache.ts';

/**
 * What every scheduled job and every step is given and answers (docs/social/build.md, D7 and section
 * 7.2). The minute job (`minute.ts`) runs its steps in order, each step one file under `steps/` that
 * a relay fills: this file and `minute.ts` are the shared frame, so none of them is edited by an area.
 */

/** The IDs a step changed: what the recount takes, and the purge purges. UUIDs, in the order found, none twice. */
export type Ids = { stories: string[]; posts: string[]; agents: string[] };

/** No IDs yet. */
export const noIds = (): Ids => ({ stories: [], posts: [], agents: [] });

/** Every ID of each list, once, in the order found. */
export function mergeIds(...many: readonly Partial<Ids>[]): Ids {
  const merged = noIds();
  for (const kind of ['stories', 'posts', 'agents'] as const) {
    merged[kind] = [...new Set(many.flatMap((ids) => ids[kind] ?? []))];
  }
  return merged;
}

/** What a job may use: one database transaction at a time as the job, Redis, and the clock. */
export type JobDeps = {
  /** One transaction as the app's role with nobody signed in (the job's caller in the database). */
  run: Run;
  /** Social's Redis client and prefix, or null where Redis isn't set up. */
  cache: SocialCache | null;
  now: () => Date;
};

/** The real dependencies of a job, or null where the database isn't set up. */
export function jobDeps(): JobDeps | null {
  try {
    pool();
  } catch {
    return null;
  }
  return { run: asJob, cache: socialCache(), now: () => new Date() };
}

/** The steps of the minute job, in their order (`minute.ts` runs them in it). */
export type StepName = 'stories' | 'counts' | 'recount' | 'purge';

/** What a step is given. */
export type StepContext = JobDeps & {
  /** This run's lease: `social.job_end` closes it. */
  runId: string;
  /** Where the window starts: the last good run's start, less 2 minutes (`job_begin` gives it). */
  since: string;
  /** Every ID the earlier steps changed, joined: the recount takes them as `also`, the purge purges them. */
  also: Ids;
  /** What each earlier step answered, by name. */
  earlier: Readonly<Partial<Record<StepName, StepAnswer>>>;
};

/** What a step answers. */
export type StepAnswer = {
  /** The IDs it changed (joined with the earlier steps' for the ones after it). */
  ids?: Partial<Ids>;
  /** What the run's summary says of it, IDs and counts only: `job_runs.last_summary` and pg_net's answer keep it. */
  summary?: Record<string, unknown>;
  /** What a later step needs of this one's answer (the purge reads what the recount counted). Never kept in the summary. */
  data?: unknown;
};

/** One step of the minute job: its file under `steps/` exports exactly one, as `step`. */
export type Step = {
  name: StepName;
  run: (context: StepContext) => Promise<StepAnswer>;
};
