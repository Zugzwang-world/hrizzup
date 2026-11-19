import { takeAndApply } from '../tally.ts';
import type { Step } from '../types.ts';

/**
 * Step 2 of the minute job (R11; docs/social/r11-design.md, section 3.6): takes this environment's pending
 * counts of views and file reads out of Redis (one script) and applies them in one statement
 * (`../tally.ts`), answering the stories, posts and agents it changed: they join the recount's, so views move
 * Top, and the purge clears them.
 *
 * - With no Redis (`cache` null) it answers nothing and makes no statement.
 * - With nothing taken it makes no statement and says `{taken: 0}`.
 * - A Redis failure never fails it (the take is given up, and the run stays healthy, so the window keeps
 *   moving); a database statement that fails does, as every other step's does.
 * - The summary holds counts and flags only: never an ID, a device or an address.
 */
export const step: Step = {
  name: 'counts',
  async run({ run, cache }) {
    if (cache === null) return {};
    const { ids, summary } = await takeAndApply({ run, cache }, null);
    return { ids, summary };
  },
};
