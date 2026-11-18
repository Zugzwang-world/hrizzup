import { answerOf } from '../../shape.ts';
import { checkedAnswer, sampleOf } from '../answers.ts';
import { STORIES } from '../budget.ts';
import type { Step } from '../types.ts';

/**
 * Step 1 of the minute job (R5; R5's design note, M2 rule 6): lists the stories the pipeline saved since
 * the window began and moves social's own rows on a merge: `social.job_sync_stories(since)`, answering
 * the stories it touched or that survived a merge and the posts it moved. Those IDs join the recount's
 * (`ids`), and the purge reads them: a story the pipeline changed is on the board's tag even where it
 * was just withdrawn.
 *
 * One transaction, with its own statement and lock limits (`budget.ts`). The summary holds counts and
 * the first 20 IDs of each list, never anything the database said in words.
 */

const FUNCTION = 'social.job_sync_stories';

export const step: Step = {
  name: 'stories',
  async run({ run, since }) {
    const answer = await run(
      async (tx) =>
        answerOf((await tx.query(`select ${FUNCTION}($1::timestamptz) as answer`, [since])).rows),
      STORIES,
    );
    const { stories, posts } = checkedAnswer(FUNCTION, answer, ['stories', 'posts']);
    return {
      ids: { stories, posts },
      summary: {
        counts: { stories: stories.length, posts: posts.length },
        sample: { stories: sampleOf(stories), posts: sampleOf(posts) },
      },
    };
  },
};
