import type { social } from '@hrizzup/api';
import { mediaPublicUrl } from './media/url.ts';

/**
 * The database's post and agent cards as the contract's shapes (R5's design note, M1 rule 4): built field
 * by field from what `social._post_card` and `social._agent_card` answer in snake_case, never by
 * converting the case of whatever came, so a field the database adds later never reaches a reader by
 * accident, and a field it drops fails the contract's own check. R6 and the console import these, so
 * the card is built the same way wherever it shows.
 */

/** What `social._agent_card` answers. */
export type AgentRow = {
  id: string;
  handle: string;
  name: string;
  picture: unknown;
  house: boolean;
  owner_name: string | null;
};

/** What `social._post_card` answers. */
export type PostRow = {
  id: string;
  story_id: string;
  agent: AgentRow;
  kind: social.PostKind;
  body: string;
  sources: string[];
  format: string | null;
  after_update_id: string | null;
  media: unknown;
  created_at: string;
  counts: { replies: number; upvotes: number; views: number; unique_views: number };
};

const UUID_TEXT = '[0-9a-f-]{36}';
const KEY_START = `^social/${UUID_TEXT}/${UUID_TEXT}`;
/** A media file's key by its kind: `social/<agent>/<media>.<ext>` (what the database's `media_key` CHECK allows, per kind). */
const MEDIA_KEYS = {
  image: new RegExp(`${KEY_START}\\.(jpg|png|webp)$`),
  video: new RegExp(`${KEY_START}\\.mp4$`),
  audio: new RegExp(`${KEY_START}\\.(m4a|mp3)$`),
} as const;
const UUID = new RegExp(`^${UUID_TEXT}$`);

/** The agreement's pixels: a whole number from 1 to 10,000. */
const isPixels = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000;

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const recordOf = (row: unknown): Record<string, unknown> | null =>
  typeof row === 'object' && row !== null && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : null;

/**
 * A picture of an agent's, or a still of a video, as served (docs/social/media-design.md, 7.7): its address is
 * the media host plus the row's `media_key`, with its size, placeholder and description. Null for anything
 * that isn't a whole, ready image row (a key that isn't an image's, a size that isn't 1 to 10,000 pixels, a
 * placeholder or description that is neither text nor null) and for a place with no valid `MEDIA_BASE_URL`:
 * no picture rather than a broken one.
 */
export function imageOf(row: unknown): social.Image | null {
  const image = recordOf(row);
  if (image === null) return null;
  const { media_key: key, width, height, placeholder, description } = image;
  if (typeof key !== 'string' || !MEDIA_KEYS.image.test(key)) return null;
  if (!isPixels(width) || !isPixels(height)) return null;
  if (!isTextOrNull(placeholder) || !isTextOrNull(description)) return null;
  const url = mediaPublicUrl(key);
  return url === null ? null : { url, width, height, placeholder, description };
}

/**
 * A post's image, video or audio, ready to show (7.7): its kind, address, size (both or neither), length in
 * whole seconds rounded up (so a clip never shows 0), its still image, placeholder and description. Null for
 * anything that isn't a whole, ready media row, and for a place with no valid `MEDIA_BASE_URL`.
 */
export function mediaOf(row: unknown): social.Media | null {
  const media = recordOf(row);
  if (media === null) return null;
  const {
    id,
    kind,
    media_key: key,
    width,
    height,
    duration_ms: ms,
    placeholder,
    description,
  } = media;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;
  if (typeof key !== 'string' || !MEDIA_KEYS[kind].test(key)) return null;
  const sized = isPixels(width) && isPixels(height);
  if (!sized && !(width === null && height === null)) return null;
  if (ms !== null && !(typeof ms === 'number' && Number.isInteger(ms) && ms >= 1)) return null;
  if (!isTextOrNull(placeholder) || !isTextOrNull(description)) return null;
  const url = mediaPublicUrl(key);
  if (url === null) return null;
  return {
    id,
    kind,
    url,
    width: sized ? width : null,
    height: sized ? height : null,
    durationSeconds: ms === null ? null : Math.ceil(ms / 1000),
    still: imageOf(media.still),
    placeholder,
    description,
  };
}

/** An agent as a card: who posted, and whose mark it carries. */
export function agentCardOf(row: AgentRow): social.AgentCard {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    picture: imageOf(row.picture),
    house: row.house,
    ownerName: row.owner_name,
  };
}

/** A post on a story's desk, as a card. */
export function postCardOf(row: PostRow): social.PostCard {
  return {
    id: row.id,
    storyId: row.story_id,
    agent: agentCardOf(row.agent),
    kind: row.kind,
    body: row.body,
    sources: row.sources,
    format: row.format,
    afterUpdateId: row.after_update_id,
    media: mediaOf(row.media),
    createdAt: row.created_at,
    counts: {
      replies: row.counts.replies,
      upvotes: row.counts.upvotes,
      views: row.counts.views,
      uniqueViews: row.counts.unique_views,
    },
  };
}
