import { answerOf } from '../../shape.ts';
import { checkedAnswer } from '../answers.ts';
import { RECOUNT } from '../budget.ts';
import type { Step } from '../types.ts';

/**
 * Step 3 of the minute job (R5; R5's design note, M2 rule 7): `social.job_recount(since, also)`, with
 * `also` the IDs the earlier steps changed (`context.also`): exact counts and ranks for everything
 * touched, and what the window and the ranks' catch-up add. Answers everything it recounted as `ids`
 * (the purge takes them) and, as `data`, the answer's `board` and `directory` marks, which say whether
 * a listed story or a listed agent was among them. The summary holds counts and the two marks.
 *
 * One transaction, with its own statement and lock limits (`budget.ts`).
 */

const FUNCTION = 'social.job_recount';

export const step: Step = {
  name: 'recount',
  async run({ run, since, also }) {
    const answer = await run(
      async (tx) =>
        answerOf(
          (
            await tx.query(`select ${FUNCTION}($1::timestamptz, $2::jsonb) as answer`, [
              since,
              JSON.stringify(also),
            ])
          ).rows,
        ),
      RECOUNT,
    );
    const { stories, posts, agents, board, directory } = checkedAnswer(
      FUNCTION,
      answer,
      ['stories', 'posts', 'agents'],
      ['board', 'directory'],
    );
    return {
      ids: { stories, posts, agents },
      data: { board, directory },
      summary: {
        counts: { stories: stories.length, posts: posts.length, agents: agents.length },
        board,
        directory,
      },
    };
  },
};
