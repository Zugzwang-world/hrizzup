import { type Brief, type BriefData, buildBrief } from '@hrizzup/social/brief';
import { briefLabels } from '@hrizzup/social/lists';
import { socialRedis } from '@hrizzup/social/redis';
import { asApp } from './access.ts';
import { redisPrefix, remember } from './cache.ts';
import { answerOf } from './shape.ts';

/**
 * A story's brief as the API answers it (docs/social/build.md, section 7.4; R5's design note, M1
 * rule 6 and R3): the one place both the public read and the agent's pin get a brief from.
 *
 * - **`briefOf` is pure:** the same data gives the same `version`, so R6's pin builds the brief from
 *   `social.pin`'s own `brief_data` with no second trip, and a reader of the public read sees the
 *   very version the pin shows.
 * - **`loadBrief` asks Redis first,** then the database, and keeps a copy for 120 seconds under the
 *   ID of the story it describes, and no other: a story merged into another answers the surviving
 *   story's brief, and only the surviving story's own recount (or console save) deletes its copy, so
 *   a copy kept under the merged ID would outlive the surviving story's changes. Nothing is kept for a
 *   withdrawn story or for an ID that isn't known (`remember` never keeps a "nothing").
 */

/**
 * The brief built from `social.brief_data`'s answer, or null for a withdrawn story (nothing can be
 * written on it). `builtAt` is the moment it is made, now when not given.
 */
export function briefOf(data: BriefData, builtAt: string = new Date().toISOString()): Brief | null {
  return buildBrief(data, briefLabels(), builtAt);
}

/**
 * A story's brief, or null when the story is withdrawn (the caller answers 422 `story_not_live`). An
 * ID that is no story's is a 404, from the database. The ID is read in lower case, as every ID is.
 * Where Redis isn't set up, or can't answer, the database answers and nothing fails.
 */
export async function loadBrief(storyId: string): Promise<Brief | null> {
  const id = storyId.toLowerCase();
  // What the database's answer made, whichever story it was about: `remember` keeps only a brief of
  // the story asked for, and this answers the rest (a merged ID's).
  const made: { brief: Brief | null } = { brief: null };
  const load = async (): Promise<Brief | null> => {
    const data = await asApp(async (tx) =>
      answerOf((await tx.query('select social.brief_data($1) as answer', [id])).rows),
    );
    made.brief = briefOf(data as BriefData);
    return made.brief?.storyId === id ? made.brief : null;
  };
  const prefix = redisPrefix();
  if (prefix === null) {
    await load();
    return made.brief;
  }
  const kept = await remember(socialRedis.brief.key(prefix, id), socialRedis.brief.seconds, load);
  return kept ?? made.brief;
}
