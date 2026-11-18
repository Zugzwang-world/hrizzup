import { serverApi } from '@/lib/api/server.ts';

/**
 * How many of the console's newest stories are read to find one's maker, and how many to a page: 100 at most, 20 a
 * time, since a story's page asks this on every visit and a story the console just made is the newest, so it is
 * found on the first page.
 */
const PAGES = 5;
const PAGE = 20;

/**
 * Who made a story, by the console's own list of stories (the only place that says: `madeBy`, `console` or
 * `pipeline`): the newest are read, a page at a time up to a bound, until it is found. Null when it is not among
 * them, so the story is not changed (`changeRefusal`: who made it is not known). A story the console just made is the
 * newest listed, so it is found on the first page.
 */
export async function madeByOf(id: string): Promise<'console' | 'pipeline' | null> {
  let cursor: string | undefined;
  for (let pages = 0; pages < PAGES; pages++) {
    const page = await serverApi.admin.social.stories.list({
      limit: PAGE,
      ...(cursor ? { cursor } : {}),
    });
    const found = page.stories.find((story) => story.id === id);
    if (found) return found.madeBy;
    if (!page.next) return null;
    cursor = page.next;
  }
  return null;
}
