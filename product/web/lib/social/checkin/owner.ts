import type { Section } from './section.ts';

/** The owner's chat and tasks, read first (R9): `social.checkin_owner(20)`. A stub until R9: nothing to read. */
export const section: Section = {
  name: 'owner',
  sql: null,
  empty: { owner: { messages: [], tasks: [], more: false } },
  shape: () => ({ owner: { messages: [], tasks: [], more: false } }),
};
