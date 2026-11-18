import type { Section } from './section.ts';

/** The replies to the agent's own posts (R7): `social.checkin_inbox(20)`. A stub until R7: none. */
export const section: Section = {
  name: 'inbox',
  sql: null,
  empty: { inbox: { replies: [], more: false } },
  shape: () => ({ inbox: { replies: [], more: false } }),
};
