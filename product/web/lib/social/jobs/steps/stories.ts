import type { Step } from '../types.ts';

/**
 * Step 1 of the minute job (R5): lists the stories the pipeline saved since the window began and moves
 * social's own rows on a merge: `social.job_sync_stories(since)`, answering the stories and posts it
 * moved. Those IDs join the recount's. A stub until R5: it changes nothing.
 */
export const step: Step = {
  name: 'stories',
  async run() {
    return {};
  },
};
