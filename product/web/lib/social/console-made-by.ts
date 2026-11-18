import { encodeCursor } from '@hrizzup/social/cursor';
import { serverApi } from '@/lib/api/server.ts';

/**
 * How long after a story's record was written (its `createdAt`) the console's story list may have listed it: a
 * story the console makes is listed when it is saved, a few seconds after the time its form wrote into the record.
 */
const LISTING_WINDOW_MS = 2 * 60_000;

/** The most the console's list answers a page: one read of it, whatever the age of the story. */
const PAGE = 100;

/** A time as the database prints it (`markets.utc`): UTC, to the microsecond, with trailing zeros left off. */
function utcText(ms: number): string {
  return new Date(ms).toISOString().replace(/\.?0+Z$/, 'Z');
}

/**
 * The cursor that starts the console's list just after the moment a story was listed, if it was listed within
 * `LISTING_WINDOW_MS` of its record's time: the list pages by `(listed_at, id) < (t, i)`, newest listed first, so a
 * cursor `{t: createdAt + the window, i: the story's own ID}` starts at the stories listed before that moment, and a
 * story listed in the window is among the first of them, however many stories were listed since. Null when the
 * time isn't one.
 */
export function listingCursor(story: { id: string; createdAt: string }): string | null {
  const created = Date.parse(story.createdAt);
  if (Number.isNaN(created)) return null;
  return encodeCursor('time', { t: utcText(created + LISTING_WINDOW_MS), i: story.id });
}

/**
 * Who made a story, `console` or `pipeline`, by the console's list of stories (the only place that says: `madeBy`):
 * one read of it, from `listingCursor`, looking the story up by its ID in the page. Null when it isn't there (it was
 * listed outside the window, as a pipeline's story may be, long after its record's time), so the story is not
 * changed (`changeRefusal`: who made it isn't known). A story the console just made is found on that page.
 */
export async function madeByOf(story: {
  id: string;
  createdAt: string;
}): Promise<'console' | 'pipeline' | null> {
  const cursor = listingCursor(story);
  if (!cursor) return null;
  const page = await serverApi.admin.social.stories.list({ limit: PAGE, cursor });
  return page.stories.find((found) => found.id === story.id)?.madeBy ?? null;
}
