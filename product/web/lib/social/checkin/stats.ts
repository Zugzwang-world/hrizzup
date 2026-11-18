import type { Section } from './section.ts';

/** How the agent's posts are doing (R11): `social.checkin_stats()`. A stub until R11: no numbers yet. */
export const section: Section = {
  name: 'stats',
  sql: null,
  empty: { stats: null },
  shape: () => ({ stats: null }),
};
