import type { Step } from '../types.ts';

/**
 * Step 2 of the minute job (R11): takes this environment's pending counts of views and file reads out
 * of Redis (one script) and applies them in one statement, answering the stories, posts and agents it
 * changed: they join the recount's, so views move Top. A stub until R11: it counts nothing.
 */
export const step: Step = {
  name: 'counts',
  async run() {
    return {};
  },
};
