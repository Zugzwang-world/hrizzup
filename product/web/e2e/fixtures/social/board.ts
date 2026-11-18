import type { SocialFixture } from './fixture.ts';

/**
 * The board area's fixture (R5; docs/social/build.md, sections 7.9 and 8.3): one unlisted test story
 * with three updates, kept on staging for the story page's screen check and journey. It is made once
 * through the console's live saves (`admin.social.stories.save`, `admin.social.updates.save`), as the
 * console's admin test account, and never changed: every record has a fixed ID and fixed times in
 * the past, so a second make finds it. It is unlisted, so it never shows on the board, and a check
 * run never makes a listed story. The third update corrects the first, so the page's corrections
 * show; each has sources, so its links show; and no post is ever written on it, so its desk is empty.
 * Nothing in it is personal: it is a placeholder story, on a placeholder source (`example.com`).
 */

/** The story's ID: a version 7 UUID of a fixed time (15 November 2026), not the market fixtures' prefix. */
export const BOARD_FIXTURE_STORY = '01a1dd93-9880-7b3e-8c41-5d2a9f6e1b07';
export const BOARD_FIXTURE_TITLE = 'Screen check: a test story kept on staging for the story page';
const BOARD_FIXTURE_SUMMARY =
  "A test story for the sandbox's story page checks, on staging only. It is unlisted, so it never shows on the board, and made once by the screen check's admin test account.";

/** The story's three updates, oldest first, as `update/1` records (the third corrects the first). */
export const BOARD_FIXTURE_UPDATES = [
  {
    id: '01a1ddca-8700-7c4f-9d52-6e3b0a7f2c18',
    headline: 'First update: a test development in the kept story',
    reportedAt: '2026-11-15T06:00:00.000Z',
    sources: ['https://example.com/sources/board-fixture-first'],
  },
  {
    id: '01a1dde5-fe40-7d50-ae63-7f4c1b8a3d29',
    headline: 'Second update: a later test development',
    body: 'The second update carries a body, in two lines.\nIt is plain text, kept as written.',
    reportedAt: '2026-11-15T06:30:00.000Z',
    sources: [
      'https://example.com/sources/board-fixture-second',
      'https://example.org/sources/board-fixture-second-more',
    ],
  },
  {
    id: '01a1de01-7580-7e61-bf74-805d2c9b4e3a',
    headline: 'Third update: a correction of the first',
    reportedAt: '2026-11-15T07:00:00.000Z',
    sources: ['https://example.com/sources/board-fixture-third'],
    corrects: '01a1ddca-8700-7c4f-9d52-6e3b0a7f2c18',
  },
] as const;

/** When the story was made and last changed: fixed, so a second save is the same record. */
const MADE_AT = '2026-11-15T05:00:00.000Z';

function storyRecord() {
  return {
    format: 'story/1',
    id: BOARD_FIXTURE_STORY,
    title: BOARD_FIXTURE_TITLE,
    summary: BOARD_FIXTURE_SUMMARY,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: MADE_AT,
    updated_at: MADE_AT,
  };
}

function updateRecord(update: (typeof BOARD_FIXTURE_UPDATES)[number]) {
  return {
    format: 'update/1',
    id: update.id,
    story_id: BOARD_FIXTURE_STORY,
    headline: update.headline,
    ...('body' in update ? { body: update.body } : {}),
    reported_at: update.reportedAt,
    sources: update.sources,
    ...('corrects' in update ? { corrects: update.corrects } : {}),
    state: 'live',
    created_at: update.reportedAt,
    updated_at: update.reportedAt,
  };
}

type Answer = { status: number; body: Record<string, unknown> };

/**
 * The board's fixture story: found by its public read, and made (or topped up) through the console's
 * saves only when something is missing. A save the database already has answers `same`, and a story
 * that an update has since moved on answers 409 `stale_record`: both mean it is there. Another run
 * making it at the same moment gets back the same records (their IDs are fixed). A failure names the
 * status only, never what was answered.
 */
export const boardFixtures: readonly SocialFixture[] = [
  {
    name: "the board's test story",
    ensure: async ({ baseURL, headers }) => {
      const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
        const response = await fetch(new URL(path, baseURL), {
          method,
          headers: {
            ...headers,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        let parsed: Record<string, unknown> = {};
        try {
          parsed = (await response.json()) as Record<string, unknown>;
        } catch {
          // Not JSON: the status says what happened.
        }
        return { status: response.status, body: parsed };
      };
      /** Whether a save went through, or the database already had what it was sent. */
      const saved = (answer: Answer) =>
        answer.status === 200 ||
        (answer.status === 409 &&
          (answer.body.data as { reason?: unknown } | undefined)?.reason === 'stale_record');

      const found = await call('GET', `/api/v1/social/stories/${BOARD_FIXTURE_STORY}`);
      if (found.status !== 200 && found.status !== 404) {
        throw new Error(`Couldn't read the board's fixture story (${found.status})`);
      }
      const have = new Set(
        found.status === 200 && Array.isArray(found.body.updates)
          ? (found.body.updates as { id?: unknown }[]).map((update) => update.id)
          : [],
      );
      if (found.status === 404) {
        const made = await call('POST', '/api/v1/admin/social/stories', {
          record: storyRecord(),
          listed: false,
        });
        if (!saved(made))
          throw new Error(`Couldn't make the board's fixture story (${made.status})`);
      }
      // Oldest first: a correction is saved after the update it corrects.
      for (const update of BOARD_FIXTURE_UPDATES) {
        if (have.has(update.id)) continue;
        const made = await call('POST', '/api/v1/admin/social/updates', {
          record: updateRecord(update),
        });
        if (!saved(made)) {
          throw new Error(
            `Couldn't make the board's fixture story's update ${update.id} (${made.status})`,
          );
        }
      }
    },
  },
];
