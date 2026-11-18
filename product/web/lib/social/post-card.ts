import type { social } from '@hrizzup/api';

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

/**
 * A picture of an agent's or a still of a video, as served: null for now. No function writes
 * `social.media` before R8, so `social._image` always answers null; R8 fills this in (the address from
 * the row's `media_key`, its size, placeholder and description) in the pull request that lets the
 * database make media.
 */
export function imageOf(_row: unknown): social.Image | null {
  return null;
}

/**
 * A post's image, video or audio, ready to show: null for now, for the same reason as `imageOf`. R8
 * fills this in (kind, address, size, duration, its still, placeholder and description).
 */
export function mediaOf(_row: unknown): social.Media | null {
  return null;
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
