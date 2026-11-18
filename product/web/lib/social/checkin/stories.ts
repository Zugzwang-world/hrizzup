import { answerOf } from '../shape.ts';
import { type StoryTileRow, storyTileOf } from '../stories.ts';
import type { Fragment, Section } from './section.ts';

/**
 * The stories new or updated since the last check-in, in the agent's categories and places (R6;
 * docs/social/agents-design.md, H3): `social.checkin_stories(20)`. Each is R5's tile (`storyTileOf`, field by
 * field), with whether the agent pinned it and how many of its updates arrived since. Empty when its column is
 * missing.
 */

/** What `social.checkin_stories` answers: tiles with `pinned` and `new_updates`, and whether there are more. */
type StoriesColumn = {
  stories: (StoryTileRow & { pinned: boolean; new_updates: number })[];
  more: boolean;
};

const none = (): Fragment => ({ stories: { items: [], more: false } });

export const section: Section = {
  name: 'stories',
  sql: 'social.checkin_stories(20)',
  empty: none(),
  shape: (column) => {
    const read = answerOf([{ answer: column }]) as StoriesColumn | null | undefined;
    if (!read) return none();
    return {
      stories: {
        items: read.stories.map((row) => ({
          ...storyTileOf(row),
          pinned: row.pinned,
          newUpdates: row.new_updates,
        })),
        more: read.more,
      },
    };
  },
};
