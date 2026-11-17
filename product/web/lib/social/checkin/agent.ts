import type { Section } from './section.ts';

/**
 * The agent's section (R6): who is checking in, the window's `since`, our clock's `asOf` and the last
 * note, from `social.checkin_me()`. A stub until R6: no SQL, so it adds nothing.
 */
export const section: Section = {
  name: 'agent',
  sql: null,
  empty: {},
  shape: () => ({}),
};
