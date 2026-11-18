import type { Ids, JobDeps } from './types.ts';

/**
 * A check run's own counting (docs/social/build.md, section 7.2, "Previews"): `POST
 * /api/jobs/social?job=counts` with the IDs the run made (`{posts, stories, files}`). It never runs
 * the shared minute job: under its own `counts` lease it takes just those fields of its environment's
 * pending counts, applies them, recounts just those IDs and purges their tags, so a run owns what it
 * changes. R11 builds it, and the door (R5's) dispatches to it from the start.
 *
 * Until R11 this answers `null`, which the door turns into "No such call", as for any address the API
 * doesn't have.
 */

/** What a check run sends. */
export type CountsRequest = { posts: string[]; stories: string[]; files: string[] };

/** What the run answers: the IDs it recounted, or that another run held the `counts` lease. */
export type CountsAnswer = { ran: false; busy: true } | { ran: true; ok: boolean; ids: Ids };

export async function runCounts(
  _request: CountsRequest,
  _deps: JobDeps,
): Promise<CountsAnswer | null> {
  return null;
}
