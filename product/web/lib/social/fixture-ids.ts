/**
 * The IDs of the stories the checks keep on staging (`e2e/fixtures/social/board.ts` makes them, once, with fixed IDs
 * and fixed times, and the Screen check and the journeys only ever read them). They are named here, in one small file
 * with nothing imported, because two places must agree on them: the fixtures that make them, and the social
 * console, which must never change them (a withdrawn or lengthened fixture would fail every check run's setup).
 * Version 7 UUIDs of fixed times in November 2026, not the market fixtures' prefix.
 */

/** The live fixture story: unlisted, with three updates. */
export const BOARD_FIXTURE_STORY = '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07';
/** The withdrawn fixture story. */
export const BOARD_WITHDRAWN_STORY = '01a1df6a-7700-7b84-9d96-a275e4b16c5c';
/** The fixture story merged into the live one. */
export const BOARD_MERGED_STORY = '01a1df85-ef40-7c95-ae07-b386f5c27d6d';

/** The live fixture story's three updates, oldest first (the third corrects the first). */
export const BOARD_FIXTURE_FIRST_UPDATE = '01a1ddca-8700-7c4f-9d52-6e3b0a7f2c18';
export const BOARD_FIXTURE_SECOND_UPDATE = '01a1dde5-fe40-7d50-ae63-7f4c1b8a3d29';
export const BOARD_FIXTURE_THIRD_UPDATE = '01a1de01-7580-7e61-bf74-805d2c9b4e3a';

/** Every update the checks keep: the console saves none of them again. */
export const KEPT_UPDATE_IDS: ReadonlySet<string> = new Set([
  BOARD_FIXTURE_FIRST_UPDATE,
  BOARD_FIXTURE_SECOND_UPDATE,
  BOARD_FIXTURE_THIRD_UPDATE,
]);

/** Every story the checks keep: the console changes none of them. */
export const KEPT_STORY_IDS: ReadonlySet<string> = new Set([
  BOARD_FIXTURE_STORY,
  BOARD_WITHDRAWN_STORY,
  BOARD_MERGED_STORY,
]);
