import { forgetBriefs, purgePlan, purgeTags } from '../../purge.ts';
import { PURGE_WAIT_MS } from '../budget.ts';
import type { Step } from '../types.ts';

/**
 * Step 4 of the minute job (R5; R5's design note, R6 and M2 rule 8): deletes the Redis brief of every
 * story recounted, then purges the edge's tags of every story, desk, post and agent recounted (16 tags
 * a call, 50 calls at most; past that, `social:board` and the directory's tag only), with
 * `invalidateByTag`. It reads what the recount answered (`context.earlier.recount`), and what the
 * stories step answered: a story the pipeline touched is on the board's tag whatever the recount's
 * `board` mark says, since that mark needs a story that is live, and one just withdrawn must leave the
 * board.
 *
 * Briefs first, so the edge's refresh can't read the old copy. A purge that fails or runs late leaves
 * the run healthy (the copies age out by their own edge life): the summary counts it, and the next
 * change purges again. The summary holds counts and flags only.
 */

type Marks = { board?: unknown; directory?: unknown };

export const step: Step = {
  name: 'purge',
  async run({ earlier }) {
    const recounted = earlier.recount;
    const marks = (recounted?.data ?? {}) as Marks;
    const touched = earlier.stories?.ids?.stories ?? [];
    const plan = purgePlan({
      stories: recounted?.ids?.stories ?? [],
      posts: recounted?.ids?.posts ?? [],
      agents: recounted?.ids?.agents ?? [],
      board: marks.board === true || touched.length > 0,
      directory: marks.directory === true,
    });
    await forgetBriefs(plan.briefs);
    const result = await purgeTags(plan.tags, { waitMs: PURGE_WAIT_MS });
    return {
      summary: {
        briefs: plan.briefs.length,
        tags: plan.tags.length,
        calls: result.calls,
        failed: result.failed,
        late: result.late,
        overflow: plan.overflow,
      },
    };
  },
};
