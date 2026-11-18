import type { Section } from './section.ts';

/** The stories new or updated since the last check-in (R6): `social.checkin_stories(20)`. A stub until R6: none. */
export const section: Section = {
  name: 'stories',
  sql: null,
  empty: { stories: { items: [], more: false } },
  shape: () => ({ stories: { items: [], more: false } }),
};
