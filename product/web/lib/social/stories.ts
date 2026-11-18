import type { social } from '@hrizzup/api';

/**
 * A story, its tile and its updates as the contract's shapes (R5's design note, M1 rule 4): built field by
 * field from what `social._story_tile`, `social._update_card` and `social.story` answer in
 * snake_case, never by converting the case of whatever came (a field the database adds later must not
 * reach a reader by accident, and a field it drops fails the contract's own check).
 */

/** What `social._story_tile` answers. */
export type StoryTileRow = {
  id: string;
  title: string;
  summary: string;
  categories: string[];
  places: string[];
  created_at: string;
  latest_at: string;
  latest_headline: string | null;
  counts: {
    posts: number;
    replies: number;
    upvotes: number;
    views: number;
    unique_views: number;
    pins: number;
  };
};

/** What `social._update_card` answers. */
export type UpdateRow = {
  id: string;
  headline: string;
  body: string | null;
  reported_at: string;
  sources: string[];
  corrects: string | null;
};

/** What `social.story` answers for a live story (a merged one answers the story it went into, with `requested_id`). */
export type LiveStoryRow = StoryTileRow & {
  state: 'live';
  requested_id: string | null;
  listed: boolean;
  updates: UpdateRow[];
  more_updates: boolean;
};

/** What `social.story` answers for a withdrawn story: its state and reason only. */
export type WithdrawnStoryRow = {
  id: string;
  state: 'withdrawn';
  withdrawn_reason: string | null;
  requested_id: string | null;
};

/** A story as a tile on the board. */
export function storyTileOf(row: StoryTileRow): social.StoryTile {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    categories: row.categories,
    places: row.places,
    createdAt: row.created_at,
    latestAt: row.latest_at,
    latestHeadline: row.latest_headline,
    counts: {
      posts: row.counts.posts,
      replies: row.counts.replies,
      upvotes: row.counts.upvotes,
      views: row.counts.views,
      uniqueViews: row.counts.unique_views,
      pins: row.counts.pins,
    },
  };
}

/** One update of a story. */
export function updateOf(row: UpdateRow): social.Update {
  return {
    id: row.id,
    headline: row.headline,
    body: row.body,
    reportedAt: row.reported_at,
    sources: row.sources,
    corrects: row.corrects,
  };
}

/**
 * One story as `social.story` answers it: a live one is its tile with its newest updates, a withdrawn
 * one its state and reason only. Anything else is a bug of ours (the database never answers a story
 * as `merged`), so it throws, and the call answers 500 rather than a shape no client expects.
 */
export function storyDetailOf(row: LiveStoryRow | WithdrawnStoryRow): social.StoryDetail {
  switch (row.state) {
    case 'live':
      return {
        ...storyTileOf(row),
        state: 'live',
        requestedId: row.requested_id,
        listed: row.listed,
        updates: row.updates.map(updateOf),
        moreUpdates: row.more_updates,
      };
    case 'withdrawn':
      return {
        id: row.id,
        state: 'withdrawn',
        withdrawnReason: row.withdrawn_reason,
        requestedId: row.requested_id,
      };
    default:
      throw new TypeError(
        `social.story answered a story as ${JSON.stringify((row as { state?: unknown }).state)}, which is neither live nor withdrawn`,
      );
  }
}
