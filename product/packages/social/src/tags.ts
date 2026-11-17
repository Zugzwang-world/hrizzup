import { idOrThrow } from './uuid.ts';

/**
 * Edge tags for social's public reads (docs/social/build.md, D6 and section 6).
 *
 * Every public read carries its contract tag, which names its family (`social:stories`), plus a tag
 * for each thing it shows (`social:story:<id>`), so the website can clear one story, one desk, one
 * post or one agent, or a whole family. A tag is one that Vercel takes: no commas, under 256 bytes,
 * and a response carries at most 8 of ours (Vercel allows 128).
 *
 * - **Only IDs go into a tag,** UUIDs in lower case, never a name, an address or anything personal;
 *   a builder refuses anything else, so a comma can't get in through an ID.
 * - **No Node-only code,** so a page may import this file (`@hrizzup/social/tags`).
 */

/** Vercel's tag size limit is 256 bytes; ours stay under it. */
export const MAX_TAG_BYTES = 255;
/** The most tags one response carries. */
export const MAX_TAGS_PER_RESPONSE = 8;

/**
 * The contract's tags, one for each family of reads, so a change of shape can clear a whole family
 * (section 6). Fixed and never empty. `agents` is the directory's tag too.
 */
export const familyTags = {
  lists: 'social:lists',
  formats: 'social:formats',
  basics: 'social:basics',
  board: 'social:board',
  stories: 'social:stories',
  desks: 'social:desks',
  briefs: 'social:briefs',
  posts: 'social:posts',
  agents: 'social:agents',
  skills: 'social:skills',
  assets: 'social:assets',
} as const;

/** A story, its updates and its brief (a merged story's too). */
export const storyTag = (id: string): string => `social:story:${idOrThrow(id, 'A story ID')}`;
/** A story's desk: its posts and the replies under them. */
export const deskTag = (storyId: string): string =>
  `social:desk:${idOrThrow(storyId, "A desk's story ID")}`;
/** One post. */
export const postTag = (id: string): string => `social:post:${idOrThrow(id, 'A post ID')}`;
/** One agent: its profile, posts, files and timeline. */
export const agentTag = (id: string): string => `social:agent:${idOrThrow(id, 'An agent ID')}`;

const encoder = new TextEncoder();

/** Whether Vercel would take the tag: not empty, no comma, no spaces or control characters, under 256 bytes. */
export function isValidTag(tag: unknown): tag is string {
  if (typeof tag !== 'string' || tag.length === 0) return false;
  if (/[,\s]/.test(tag)) return false;
  for (const character of tag) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return encoder.encode(tag).length <= MAX_TAG_BYTES;
}

/**
 * A response's tags, checked: each one valid, repeats dropped (the first of each kept, in order),
 * at most 8. Throws a TypeError for a tag Vercel would refuse and a RangeError for too many, since
 * either is a mistake in the code that chose them.
 */
export function checkedTags(tags: readonly string[]): string[] {
  const unique: string[] = [];
  for (const tag of tags) {
    if (!isValidTag(tag)) {
      throw new TypeError(
        `${JSON.stringify(tag)} is not a tag Vercel takes: no commas, spaces or more than ${MAX_TAG_BYTES} bytes`,
      );
    }
    if (!unique.includes(tag)) unique.push(tag);
  }
  if (unique.length > MAX_TAGS_PER_RESPONSE) {
    throw new RangeError(
      `A response carries at most ${MAX_TAGS_PER_RESPONSE} tags, not ${unique.length}`,
    );
  }
  return unique;
}
