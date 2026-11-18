import type { Step } from '../types.ts';

/**
 * Step 3 of the minute job (R5): `social.job_recount(since, also)`, with `also` the IDs the earlier steps
 * changed (`context.also`): exact counts and ranks for everything touched. Answers everything it
 * recounted as `ids` (the purge takes them) and, as `data`, the answer's `board` and `directory`
 * marks. A stub until R5: it recounts nothing.
 */
export const step: Step = {
  name: 'recount',
  async run() {
    return {};
  },
};
