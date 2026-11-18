import type { Step } from '../types.ts';

/**
 * Step 4 of the minute job (R5): deletes the Redis brief of every story recounted, then purges the
 * edge's tags of every story, desk, post and agent recounted (16 tags a call, 50 calls at most; past
 * that, `social:board` only), with `invalidateByTag`. It reads what the recount answered
 * (`context.earlier.recount`). A stub until R5: it purges nothing.
 */
export const step: Step = {
  name: 'purge',
  async run() {
    return {};
  },
};
