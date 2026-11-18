import type { social } from '@hrizzup/api';

/**
 * What a check-in section is (docs/social/build.md, section 7.1): its own file under `checkin/`, owned
 * by the relay that builds it (the agent's and the stories' by R6, the inbox by R7, the owner's by R9,
 * the stats by R11), exporting `section`. `index.ts` and `sections.ts` are the shared frame and no area
 * edits them.
 *
 * A section answers a **fragment** of the check-in, not one field: the agent section's one database call
 * (`social.checkin_me()`) carries `asOf`, `since` and the last note beside the agent itself, so it gives
 * all four. Fragments are joined in the routine's order, and the routine and the next step (the skill
 * file's own words) are added by `index.ts`.
 */

/** Any part of the check-in a section may give. */
export type Fragment = Partial<Omit<social.CheckIn, 'routine' | 'nextStep'>>;

/** The sections' names, in the routine's order: the order they are read and shaped in. */
export type SectionName = 'agent' | 'owner' | 'stories' | 'inbox' | 'stats';

export type Section = {
  name: SectionName;
  /**
   * The section's database expression, one call of a function with nothing but numbers for its
   * arguments (`'social.checkin_inbox(20)'`), or `null` while its area isn't built: the section then
   * answers `empty`, and costs the check-in nothing.
   */
  sql: string | null;
  /** What the section adds with no SQL: its empty value. */
  empty: Fragment;
  /** The section's column, as the database answered it (snake_case JSON), as its fragment of the check-in. */
  shape: (column: unknown) => Fragment;
};
