import { forgetBriefs, purgePlan, purgeTags } from '../purge.ts';
import { answerOf } from '../shape.ts';
import { checkedAnswer } from './answers.ts';
import { PURGE_WAIT_MS, RECOUNT } from './budget.ts';
import {
  onDeadlock,
  readTargets,
  type Tally,
  takeAndApply,
  type Wanted,
  withRetries,
} from './tally.ts';
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

/** The counts lease: a run of 18 seconds at most (the door's deadline), so 30 leaves it room to end. */
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
  const retried: string[] = [];
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
          targets: await readTargets(run, wanted, retried),
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
      // One try again for a deadlock, on the recount alone: the apply before it has committed and never runs twice.
      const answer = await onDeadlock('recount', retried, () =>
        run(
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
        ),
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
      JSON.stringify(withRetries(summary, retried)),
    ]),
  );
  return { ran: true, ok, ids: recounted };
}
