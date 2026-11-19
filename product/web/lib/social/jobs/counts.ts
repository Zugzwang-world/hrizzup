import { forgetBriefs, purgePlan, purgeTags } from '../purge.ts';
import { answerOf } from '../shape.ts';
import { checkedAnswer } from './answers.ts';
import { PURGE_WAIT_MS, RECOUNT } from './budget.ts';
import { readTargets, type Tally, takeAndApply, type Wanted } from './tally.ts';
import { type Ids, type JobDeps, mergeIds, noIds } from './types.ts';

/**
 * A check run's own counting (docs/social/build.md, section 7.2, "Previews"; docs/social/r11-design.md,
 * section 3.7): `POST /api/jobs/social?job=counts` with the IDs the run made (`{posts, stories, files}`). It
 * never runs the shared minute job: under its own `counts` lease it takes just those fields of its
 * environment's pending counts, applies them, recounts just those IDs and purges their tags, so a run owns
 * what it changes. The door (R5's) dispatches here.
 *
 * 1. `social.job_begin('counts', 30)`: another run holding the lease answers `busy`, and nothing is done;
 * 2. the take and the apply (`tally.ts`): only the request's own fields, and the targets of every one of its
 *    IDs, so the recount also takes each post's story and agent and each file's agent;
 * 3. `social.job_recount(null, also)` with the budget's recount limits, then the purge R5 built
 *    (`purgePlan`, `forgetBriefs`, `purgeTags`);
 * 4. `social.job_end('counts', run, ok, summary)`, never the minute's row.
 *
 * With no Redis the recount and the purge still run for the requested IDs; only the take is skipped. A
 * failure ends the run `ok: false` and is logged by name and code. Redis is never the reason it fails.
 */

/** What a check run sends. */
export type CountsRequest = { posts: string[]; stories: string[]; files: string[] };

/** What the run answers: the IDs it recounted, or that another run held the `counts` lease. */
export type CountsAnswer = { ran: false; busy: true } | { ran: true; ok: boolean; ids: Ids };

/**
 * The counts lease, in seconds. The run is planned at about 14.5 seconds (`budget.ts`: begin 2, take 0.75, targets
 * 0.5, uniques 0.75, apply 1, recount 5, purge 2.5, end 2), so 30 is about twice that. The door answers by its 18
 * second deadline whatever the run is doing, and the run carries on under `waitUntil` to the end, so it still closes
 * its lease; a statement `transaction` tries again can take it past the lease, which only lets another run start
 * meanwhile, and `job_end` closes only the run that holds the lease.
 */
export const COUNTS_LEASE_SECONDS = 30;

const RECOUNT_FUNCTION = 'social.job_recount';

export async function runCounts(
  request: CountsRequest,
  deps: JobDeps,
): Promise<CountsAnswer | null> {
  const { run, cache } = deps;
  const begun = await run(async (tx) =>
    answerOf(
      (
        await tx.query('select social.job_begin($1, $2) as answer', [
          'counts',
          COUNTS_LEASE_SECONDS,
        ])
      ).rows,
    ),
  );
  if (begun === null || begun === undefined) return { ran: false, busy: true };
  const { run: runId } = begun as { run?: unknown };
  if (typeof runId !== 'string') {
    throw new TypeError("The database's answer to job_begin isn't {run, since}");
  }

  let ok = true;
  let recounted: Ids = noIds();
  let summary: Record<string, unknown> = {};
  try {
    const wanted: Wanted = {
      posts: request.posts,
      stories: request.stories,
      files: request.files,
    };
    // With Redis: the take and the apply. With none: only what the request's IDs are (no take, no apply).
    const tally: Tally = cache
      ? await takeAndApply({ run, cache }, wanted)
      : {
          ids: noIds(),
          targets: await readTargets(run, wanted),
          summary: { taken: 0 },
        };
    const { targets } = tally;
    summary = tally.summary;
    const also = mergeIds(tally.ids, {
      posts: targets.posts.map((post) => post.id),
      stories: [...targets.posts.map((post) => post.storyId), ...targets.stories],
      agents: [
        ...targets.posts.map((post) => post.agentId),
        ...targets.files.map((file) => file.agentId),
      ],
    });
    if (also.stories.length + also.posts.length + also.agents.length > 0) {
      const answer = await run(
        async (tx) =>
          answerOf(
            (
              await tx.query(`select ${RECOUNT_FUNCTION}($1::timestamptz, $2::jsonb) as answer`, [
                null,
                JSON.stringify(also),
              ])
            ).rows,
          ),
        RECOUNT,
      );
      const checked = checkedAnswer(
        RECOUNT_FUNCTION,
        answer,
        ['stories', 'posts', 'agents'],
        ['board', 'directory'],
      );
      recounted = { stories: checked.stories, posts: checked.posts, agents: checked.agents };
      const plan = purgePlan({ ...recounted, board: checked.board, directory: checked.directory });
      await forgetBriefs(plan.briefs);
      await purgeTags(plan.tags, { waitMs: PURGE_WAIT_MS });
    }
  } catch (error) {
    ok = false;
    // The log gets the error's name and code, never its text, which may quote data.
    const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
    console.error('social counts door: a run failed', { name, code });
  }

  await run((tx) =>
    tx.query('select social.job_end($1, $2, $3, $4::jsonb)', [
      'counts',
      runId,
      ok,
      JSON.stringify(summary),
    ]),
  );
  return { ran: true, ok, ids: recounted };
}
