import { social } from '@hrizzup/api';
import { social as examples } from '@hrizzup/api/examples';
import { describe, expect, it } from 'vitest';
import {
  type LiveStoryRow,
  type StoryTileRow,
  storyDetailOf,
  storyTileOf,
  type UpdateRow,
  updateOf,
  type WithdrawnStoryRow,
} from './stories.ts';

const story = examples.board.storyDetail;
if (story.state !== 'live') throw new Error('The example story is live');

const tileRow = (): StoryTileRow => ({
  id: story.id,
  title: story.title,
  summary: story.summary,
  categories: story.categories,
  places: story.places,
  created_at: story.createdAt,
  latest_at: story.latestAt,
  latest_headline: story.latestHeadline,
  counts: {
    posts: story.counts.posts,
    replies: story.counts.replies,
    upvotes: story.counts.upvotes,
    views: story.counts.views,
    unique_views: story.counts.uniqueViews,
    pins: story.counts.pins,
  },
  picture: null,
});
/** What `social._image` answers for a picture: the row `imageOf` turns into the contract's `Image`. */
const pictureRow = {
  media_key: 'social/019a7b10-0000-7000-8000-0000000000a1/019a7b10-0000-7000-8000-0000000000b1.jpg',
  width: 1280,
  height: 720,
  placeholder: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
  description: 'The coast road at dawn',
};
const updateRows = (): UpdateRow[] =>
  story.updates.map((update) => ({
    id: update.id,
    headline: update.headline,
    body: update.body,
    reported_at: update.reportedAt,
    sources: update.sources,
    corrects: update.corrects,
  }));
const liveRow = (changes: Partial<LiveStoryRow> = {}): LiveStoryRow => ({
  ...tileRow(),
  state: 'live',
  requested_id: story.requestedId,
  listed: story.listed,
  updates: updateRows(),
  more_updates: story.moreUpdates,
  ...changes,
});

describe('a story tile', () => {
  it('is the contract’s tile, field for field, with the counts in camelCase', () => {
    const tile = storyTileOf(tileRow());
    expect(social.storyTile.parse(tile)).toEqual(tile);
    expect(tile.counts).toEqual(story.counts);
    expect(tile.latestHeadline).toBe(story.latestHeadline);
  });

  it('carries the story’s picture, which is null when it has none', () => {
    const tile = storyTileOf({ ...tileRow(), picture: null });
    expect(tile).toHaveProperty('picture', null);
    expect(social.storyTile.parse(tile).picture).toBeNull();
    expect(tile.picture).toBe(story.picture);
    // A row without the key (a database that does not answer it yet) is a story with no picture.
    const { picture: _picture, ...without } = tileRow();
    expect(storyTileOf(without as StoryTileRow).picture).toBeNull();
  });

  it('maps a picture row through `imageOf`, which answers null until R8’s uploads can make media (M2)', () => {
    const tile = storyTileOf({ ...tileRow(), picture: pictureRow });
    expect(social.storyTile.parse(tile)).toEqual(tile);
    expect(tile.picture).toBeNull();
    // The row's own snake_case keys never reach the reader as a picture.
    expect(JSON.stringify(tile)).not.toContain('media_key');
    expect(JSON.stringify(tile)).not.toContain('mediaKey');
  });

  it('keeps a story with no update yet (no latest headline)', () => {
    const tile = storyTileOf({ ...tileRow(), latest_headline: null });
    expect(social.storyTile.parse(tile).latestHeadline).toBeNull();
  });

  it('carries no field the contract does not have', () => {
    const tile = storyTileOf({ ...tileRow(), top_rank: '99', listed: false } as StoryTileRow);
    expect(Object.keys(tile).sort()).toEqual(Object.keys(social.storyTile.shape).sort());
  });
});

describe('an update', () => {
  it('is the contract’s update, with the time and the correction named as the contract has them', () => {
    const [first] = updateRows();
    if (!first) throw new Error('The example story has updates');
    const update = updateOf(first);
    expect(social.update.parse(update)).toEqual(update);
    expect(update.reportedAt).toBe(first.reported_at);
    expect(update.corrects).toBe(first.corrects);
  });
});

describe('a story detail', () => {
  it('is, for a live story, its tile with its updates (newest first, as the row has them) and whether it is listed', () => {
    const detail = storyDetailOf(liveRow());
    expect(social.storyDetail.parse(detail)).toEqual(detail);
    expect(detail).toEqual({ ...story, requestedId: story.requestedId });
    expect(detail).not.toHaveProperty('withdrawnReason');
  });

  it('keeps the ID asked for when the story was merged, and an unlisted story’s `listed: false`', () => {
    const merged = storyDetailOf(liveRow({ requested_id: 'a-merged-id' as string, listed: false }));
    expect(merged).toMatchObject({ requestedId: 'a-merged-id', listed: false });
    const none = storyDetailOf(liveRow({ requested_id: null, updates: [], more_updates: false }));
    expect(none).toMatchObject({ requestedId: null, updates: [], moreUpdates: false });
  });

  it('is, for a withdrawn story, its state and reason only', () => {
    const row: WithdrawnStoryRow = {
      id: story.id,
      state: 'withdrawn',
      withdrawn_reason: 'No exchange confirmed this.',
      requested_id: null,
    };
    const detail = storyDetailOf({ ...row, title: 'must not be copied' } as WithdrawnStoryRow);
    expect(social.storyDetail.parse(detail)).toEqual(detail);
    expect(detail).toEqual({
      id: story.id,
      state: 'withdrawn',
      withdrawnReason: 'No exchange confirmed this.',
      requestedId: null,
    });
  });

  it('throws for any other state: a story is never answered as merged, and a stray value is a bug of ours', () => {
    for (const state of ['merged', 'draft', null, undefined]) {
      expect(() => storyDetailOf({ ...liveRow(), state } as never), String(state)).toThrow(
        TypeError,
      );
    }
  });
});
