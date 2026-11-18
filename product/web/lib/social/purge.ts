import { socialRedis } from '@hrizzup/social/redis';
import { deskTag, familyTags, storyTag } from '@hrizzup/social/tags';
import { invalidateByTag, waitUntil } from '@vercel/functions';
import { forget, redisPrefix } from './cache.ts';

/**
 * Social's purges (docs/social/build.md, D6; R5's design note, R4 and M1 rule 7): the one file that
 * clears what a change made stale, at the edge (Vercel's tags) and in Redis (a story's brief), for the
 * console's saves and the minute job alike.
 *
 * - **Marked stale, never deleted** (`invalidateByTag`): the next reader still gets an answer at once
 *   while the edge fetches a new one, so every reader waiting on a deleted copy doesn't hit the server
 *   at the same moment.
 * - **16 tags a call, every call at once** (Vercel Pro allows 200 calls a second), under `waitUntil`, so
 *   the purge finishes in the background however long the wait.
 * - **A purge never fails the write that asked for it:** whatever the edge or Redis does, the save
 *   answers, and the copies age out by their own edge life (a minute at most).
 * - **Redis first:** a brief's Redis copy is deleted before any tag is purged, so the edge's refresh
 *   can't read the old copy.
 */

/** Vercel takes this many tags in one purge call. */
export const TAGS_A_CALL = 16;
/** The most calls one purge makes: 800 tags. The minute job asks for the family tags instead above it. */
export const MOST_CALLS = 50;

/** A story's own tags: its story tag (the story, its updates, its brief) and its desk's. Always together. */
export function storyTags(id: string): string[] {
  return [storyTag(id), deskTag(id)];
}

/** Deletes the Redis copies of these stories' briefs, in one command. Never fails: the copies expire in 120 seconds. */
export async function forgetBriefs(ids: readonly string[]): Promise<void> {
  const prefix = redisPrefix();
  if (prefix === null || ids.length === 0) return;
  await forget(ids.map((id) => socialRedis.brief.key(prefix, id)));
}

/** How one purge went: the calls made, those that failed, and those still running when the wait ended. */
export type PurgeResult = { calls: number; failed: number; late: number };

type Invalidate = (tags: string[]) => Promise<void>;

/**
 * Marks every edge copy carrying these tags stale: repeats removed, in calls of 16, every call started
 * at once, then a wait until all have finished or `waitMs` has passed. The calls that failed, and those
 * still running at the end of the wait, are counted; none of it throws. More than 50 calls (800 tags)
 * is the caller's mistake and throws a RangeError before anything is purged.
 */
export async function purgeTags(
  tags: readonly string[],
  options: { waitMs: number; invalidate?: Invalidate },
): Promise<PurgeResult> {
  const invalidate = options.invalidate ?? invalidateByTag;
  const unique = [...new Set(tags)];
  const chunks: string[][] = [];
  for (let from = 0; from < unique.length; from += TAGS_A_CALL) {
    chunks.push(unique.slice(from, from + TAGS_A_CALL));
  }
  if (chunks.length > MOST_CALLS) {
    throw new RangeError(
      `A purge makes at most ${MOST_CALLS} calls of ${TAGS_A_CALL} tags, not ${chunks.length}`,
    );
  }
  if (chunks.length === 0) return { calls: 0, failed: 0, late: 0 };
  const state: ('running' | 'done' | 'failed')[] = chunks.map(() => 'running');
  // `Promise.resolve().then(...)` so a purge that throws before it returns a promise is one more
  // failure counted, never an error thrown here.
  const calls = chunks.map((chunk, n) =>
    Promise.resolve()
      .then(() => invalidate(chunk))
      .then(
        () => {
          state[n] = 'done';
        },
        () => {
          state[n] = 'failed';
        },
      ),
  );
  const all = Promise.all(calls).then(() => undefined);
  waitUntil(all);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    all,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.waitMs);
    }),
  ]);
  clearTimeout(timer);
  return {
    calls: chunks.length,
    failed: state.filter((s) => s === 'failed').length,
    late: state.filter((s) => s === 'running').length,
  };
}

/**
 * What a change of these stories made stale: their briefs in Redis (deleted first), then their story
 * and desk tags at the edge, and the board's when it lists one of them. Waits up to a second and a half
 * for the edge, so whoever saved and asks again at once is served by the refresh. Catches everything and
 * logs only the error's name, so it never fails the write that asked for it.
 */
export async function refreshStories(
  ids: readonly string[],
  options: { board: boolean; invalidate?: Invalidate },
): Promise<void> {
  try {
    const stories = [...new Set(ids.map((id) => id.toLowerCase()))];
    await forgetBriefs(stories);
    const tags = [...stories.flatMap(storyTags), ...(options.board ? [familyTags.board] : [])];
    await purgeTags(tags, {
      waitMs: 1_500,
      ...(options.invalidate ? { invalidate: options.invalidate } : {}),
    });
  } catch (error) {
    // The log gets the error's name, never its text, which may quote data.
    const { name } = (error ?? {}) as { name?: unknown };
    console.error('social purge: a purge failed', { name });
  }
}
