import {
  BOARD_FIXTURE_STORY,
  BOARD_MERGED_STORY,
  BOARD_WITHDRAWN_STORY,
} from '../../../lib/social/fixture-ids.ts';
import type { SocialFixture, SocialFixtureContext } from './fixture.ts';

/**
 * The board area's fixtures (R5; docs/social/build.md, sections 7.9 and 8.3): three unlisted test stories kept
 * on staging for the story page's screen check and journey. Each is made once through the console's live saves
 * (`admin.social.stories.save`, `admin.social.updates.save`), as the console's admin test account, and never
 * changed: every record has a fixed ID and fixed times in the past, so a second make finds it. All are
 * unlisted, so none ever shows on the board, and a check run never makes a listed story.
 * - **The live story** has three updates. The third corrects the first, so the page's corrections show; each
 *   has sources, so its links show; and no post is ever written on it, so its desk is empty.
 * - **The withdrawn story** was made live, then saved again withdrawn with a reason, so its page says why.
 * - **The merged story** was made live, then saved again as merged into the live story, so its address shows the
 *   live story with a line naming it. It has no updates: a merge moves a story's updates to the one that stays, which
 *   a console save (one record, one transaction) can't do.
 * Nothing in any of them is personal: they are placeholder stories, on a placeholder source (`example.com`).
 * A desk with posts can't be fixed here until agents can post (R6's posting).
 */

/** The story's ID: a version 7 UUID of a fixed time (15 November 2026), not the market fixtures' prefix; the console must never change it (`lib/social/fixture-ids.ts` names all three). */
export { BOARD_FIXTURE_STORY, BOARD_MERGED_STORY, BOARD_WITHDRAWN_STORY };
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

/** When the withdrawn and merged stories were changed to what they are: fixed, after they were made. */
const CHANGED_AT = '2026-11-15T05:30:00.000Z';

/** The withdrawn story's reason, which its page gives (its ID and the merged story's are in `lib/social/fixture-ids.ts`). */
export const BOARD_WITHDRAWN_REASON = 'Withdrawn as a test: the kept story for the withdrawn page';
const BOARD_WITHDRAWN_TITLE =
  'Screen check: a withdrawn test story kept on staging for the story page';

/** The merged story's title. It was merged into the live story, so its address shows that one. */
const BOARD_MERGED_TITLE = 'Screen check: a merged test story kept on staging for the story page';

type Change = Record<string, unknown>;

/** A story/1 of the fixtures: live as it was made at `MADE_AT`, unless `change` says what it has become (and when). */
function storyRecord(id: string, title: string, change: Change = {}) {
  return {
    format: 'story/1',
    id,
    title,
    summary: BOARD_FIXTURE_SUMMARY,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: MADE_AT,
    updated_at: MADE_AT,
    ...change,
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

/** One call to the site as the console's admin test account; the answer's body is empty when it isn't JSON, and the status says what happened. */
async function call(
  { baseURL, headers }: SocialFixtureContext,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
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
}

/** Whether a save went through, or the database already had what it was sent. */
const saved = (answer: Answer) =>
  answer.status === 200 ||
  (answer.status === 409 &&
    (answer.body.data as { reason?: unknown } | undefined)?.reason === 'stale_record');

/** Saves a story of the fixtures, unlisted (a story's listing is fixed when it is made). A failure names the status only. */
async function saveStory(context: SocialFixtureContext, what: string, record: unknown) {
  const made = await call(context, 'POST', '/api/v1/admin/social/stories', {
    record,
    listed: false,
  });
  if (!saved(made)) throw new Error(`Couldn't make the board's ${what} (${made.status})`);
}

/** A fixture story's public read: 404 when it isn't there. Any other status than 200 and 404 is a failure, naming the status. */
async function read(context: SocialFixtureContext, id: string, what: string): Promise<Answer> {
  const found = await call(context, 'GET', `/api/v1/social/stories/${id}`);
  if (found.status !== 200 && found.status !== 404) {
    throw new Error(`Couldn't read the board's ${what} (${found.status})`);
  }
  return found;
}

/**
 * The board's live fixture story: found by its public read, and made (or topped up) through the console's
 * saves only when something is missing. A save the database already has answers `same`, and a story
 * that an update has since moved on answers 409 `stale_record`: both mean it is there. Another run
 * making it at the same moment gets back the same records (their IDs are fixed). A story that is there
 * must be what it was made as (live, unlisted, its own address), or the fixture fails, naming the status only:
 * a page checked on a story somebody has since withdrawn or listed would pass or fail for the wrong reason. A failure
 * names the status only, never what was answered.
 */
const liveStory: SocialFixture = {
  name: "the board's test story",
  ensure: async (context) => {
    const found = await read(context, BOARD_FIXTURE_STORY, 'fixture story');
    if (
      found.status === 200 &&
      !(
        found.body.state === 'live' &&
        found.body.listed === false &&
        found.body.requestedId === null
      )
    ) {
      throw new Error(`The board's fixture story isn't as it was made (${found.status})`);
    }
    const have = new Set(
      found.status === 200 && Array.isArray(found.body.updates)
        ? (found.body.updates as { id?: unknown }[]).map((update) => update.id)
        : [],
    );
    if (found.status === 404) {
      await saveStory(
        context,
        'fixture story',
        storyRecord(BOARD_FIXTURE_STORY, BOARD_FIXTURE_TITLE),
      );
    }
    // Oldest first: a correction is saved after the update it corrects.
    for (const update of BOARD_FIXTURE_UPDATES) {
      if (have.has(update.id)) continue;
      const made = await call(context, 'POST', '/api/v1/admin/social/updates', {
        record: updateRecord(update),
      });
      if (!saved(made)) {
        throw new Error(
          `Couldn't make the board's fixture story's update ${update.id} (${made.status})`,
        );
      }
    }
  },
};

/**
 * The board's withdrawn fixture story: made live, then saved again withdrawn with its reason. Found by its public
 * read, which answers a withdrawn story as `state: withdrawn` with its reason: nothing is written when it is
 * there (a live one, from a first make that stopped half way, is withdrawn; a listed or merged one is not what
 * it was made as, and fails the fixture).
 */
const withdrawnStory: SocialFixture = {
  name: "the board's withdrawn test story",
  ensure: async (context) => {
    const found = await read(context, BOARD_WITHDRAWN_STORY, 'withdrawn story');
    if (found.status === 200 && found.body.state === 'withdrawn') {
      if (found.body.withdrawnReason !== BOARD_WITHDRAWN_REASON) {
        throw new Error(`The board's withdrawn story isn't as it was made (${found.status})`);
      }
      return;
    }
    if (found.status === 200 && !(found.body.state === 'live' && found.body.listed === false)) {
      throw new Error(`The board's withdrawn story isn't as it was made (${found.status})`);
    }
    if (found.status === 404) {
      await saveStory(
        context,
        'withdrawn story',
        storyRecord(BOARD_WITHDRAWN_STORY, BOARD_WITHDRAWN_TITLE),
      );
    }
    await saveStory(
      context,
      'withdrawn story',
      storyRecord(BOARD_WITHDRAWN_STORY, BOARD_WITHDRAWN_TITLE, {
        state: 'withdrawn',
        withdrawn_reason: BOARD_WITHDRAWN_REASON,
        updated_at: CHANGED_AT,
      }),
    );
  },
};

/**
 * The board's merged fixture story: made live, then saved again as merged into the live fixture story (which the
 * area's fixtures make first). Found by its public read, which answers a merged story as the one it went into,
 * with the address asked for in `requestedId`: nothing is written when it is there.
 */
const mergedStory: SocialFixture = {
  name: "the board's merged test story",
  ensure: async (context) => {
    const found = await read(context, BOARD_MERGED_STORY, 'merged story');
    if (found.status === 200 && found.body.requestedId === BOARD_MERGED_STORY) {
      if (found.body.id !== BOARD_FIXTURE_STORY) {
        throw new Error(`The board's merged story isn't as it was made (${found.status})`);
      }
      return;
    }
    if (
      found.status === 200 &&
      !(
        found.body.state === 'live' &&
        found.body.listed === false &&
        found.body.id === BOARD_MERGED_STORY
      )
    ) {
      throw new Error(`The board's merged story isn't as it was made (${found.status})`);
    }
    if (found.status === 404) {
      await saveStory(context, 'merged story', storyRecord(BOARD_MERGED_STORY, BOARD_MERGED_TITLE));
    }
    await saveStory(
      context,
      'merged story',
      storyRecord(BOARD_MERGED_STORY, BOARD_MERGED_TITLE, {
        state: 'merged',
        merged_into: BOARD_FIXTURE_STORY,
        updated_at: CHANGED_AT,
      }),
    );
  },
};

/** The board area's fixtures, in the order they are made: the merged story needs the live one. */
export const boardFixtures: readonly SocialFixture[] = [liveStory, withdrawnStory, mergedStory];
