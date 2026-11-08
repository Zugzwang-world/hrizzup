import lists from '@hrizzup/agreement/definitions/lists.schema.json' with { type: 'json' };
import creationsJson from '@hrizzup/agreement/examples/creations.json' with { type: 'json' };
import sourcedJson from '@hrizzup/agreement/examples/sourced.json' with { type: 'json' };
import storiesJson from '@hrizzup/agreement/examples/stories.json' with { type: 'json' };
import updatesJson from '@hrizzup/agreement/examples/updates.json' with { type: 'json' };
import { exampleMedia, placeholderImage } from './media.ts';
import { sampleStories } from './samples.ts';
import { DESIGN_NOW } from './time.ts';

/**
 * The agreement's example data (agreement/examples/), joined up the way the board and the
 * story page need it, plus the design samples (samples.ts). Read on the server only.
 */

export type Story = {
  id: string;
  title: string;
  summary: string;
  locations: string[];
  categories: string[];
  state: 'live' | 'merged' | 'withdrawn';
  merged_into?: string;
  withdrawn_reason?: string;
  created_at: string;
  updated_at: string;
};

export type Update = {
  id: string;
  story_id: string;
  headline: string;
  body?: string;
  reported_at: string;
  /** The posts our bots found that this update reports (sourced items): credited while live. */
  based_on?: string[];
  sources?: string[];
  corrects?: string;
  /** Merged updates repeat another one and never show; withdrawn ones were untrue. */
  state: 'live' | 'merged' | 'withdrawn';
  merged_into?: string;
};

export type Creation = {
  id: string;
  route: 'made' | 'posted';
  kind: 'text' | 'image' | 'video';
  author: { kind: 'hrizzup' | 'creator' | 'user'; account_id: string };
  text?: string;
  image?: { key: string; width: number; height: number; alt: string; placeholder: string };
  video?: {
    stream_id: string;
    width: number;
    height: number;
    duration_seconds: number;
    alt?: string;
    placeholder?: string;
  };
  story_ids?: string[];
  categories?: string[];
  based_on?: string[];
  created_at: string;
};

export type Sourced = {
  id: string;
  kind: 'news' | 'take';
  /** Gone once the post is unavailable on X: screens then show nothing of it. */
  post?: { url: string; handle: string; name?: string; posted_at: string; media: string };
  summary?: string;
  story_ids?: string[];
  state: 'live' | 'unavailable' | 'withdrawn';
};

export const stories = storiesJson as Story[];
export const updates = updatesJson as Update[];
export const creations = creationsJson as Creation[];
export const sourced = sourcedJson as Sourced[];

type ListItem = { const: string; title: string };
const names = (items: readonly ListItem[]) =>
  Object.fromEntries(items.map((item) => [item.const, item.title]));

/** Category and location names, as the agreement's shared lists give them. */
export const categoryNames: Record<string, string> = names(lists.$defs.category.oneOf);
export const locationNames: Record<string, string> = {
  ...names(lists.$defs.global.oneOf),
  ...names(lists.$defs.national.oneOf),
  ...names(lists.$defs.local.oneOf),
};
export const categoryOrder = lists.$defs.category.oneOf.map((item) => item.const);
export const locationOrder = [
  ...lists.$defs.global.oneOf,
  ...lists.$defs.national.oneOf,
  ...lists.$defs.local.oneOf,
].map((item) => item.const);

/** A story card's picture (the agreement's decision D5). */
export type Picture =
  | {
      kind: 'image';
      /** Missing when the file isn't in storage: the placeholder shows instead. */
      src?: string;
      width: number;
      height: number;
      alt: string;
      placeholder: string;
    }
  | {
      kind: 'video';
      width: number;
      height: number;
      alt?: string;
      placeholder?: string;
      seconds: number;
    };

export type BoardStory = {
  id: string;
  title: string;
  summary: string;
  locations: string[];
  categories: string[];
  updatedAt: string;
  /** When each live update was reported, oldest first (for the pulse strip). */
  updateTimes: string[];
  latest?: string;
  takes: number;
  picture?: Picture;
  /** A design sample, not one of the agreement's examples. */
  sample: boolean;
};

/**
 * The story's newest image or video by Hrizzup or a creator (decision D5); none, and the card
 * shows the category's own look.
 */
function pictureFor(storyId: string): Picture | undefined {
  const newest = creations
    .filter(
      (c) =>
        c.story_ids?.includes(storyId) &&
        c.author.kind !== 'user' &&
        (c.kind === 'image' || c.kind === 'video'),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (newest?.image) {
    const src = exampleMedia[newest.image.key];
    return {
      kind: 'image',
      ...(src ? { src } : {}),
      width: newest.image.width,
      height: newest.image.height,
      alt: newest.image.alt,
      placeholder: placeholderImage(newest.image.placeholder),
    };
  }
  if (newest?.video) {
    return {
      kind: 'video',
      width: newest.video.width,
      height: newest.video.height,
      ...(newest.video.alt ? { alt: newest.video.alt } : {}),
      ...(newest.video.placeholder
        ? { placeholder: placeholderImage(newest.video.placeholder) }
        : {}),
      seconds: newest.video.duration_seconds,
    };
  }
  return undefined;
}

/** Every take that shows in a story's feed: found posts still live, and creations on it. */
export function takesFor(storyId: string): number {
  const found = sourced.filter(
    (s) => s.kind === 'take' && s.state === 'live' && s.story_ids?.includes(storyId),
  ).length;
  const posted = creations.filter((c) => c.story_ids?.includes(storyId)).length;
  return found + posted;
}

export function liveUpdatesOf(storyId: string): Update[] {
  return updates
    .filter((u) => u.story_id === storyId && u.state === 'live')
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at));
}

function fromExample(story: Story): BoardStory {
  const live = liveUpdatesOf(story.id);
  const picture = pictureFor(story.id);
  return {
    id: story.id,
    title: story.title,
    summary: story.summary,
    locations: story.locations,
    categories: story.categories,
    updatedAt: story.updated_at,
    updateTimes: live.map((u) => u.reported_at),
    ...(live.at(-1) ? { latest: live.at(-1)?.headline } : {}),
    takes: takesFor(story.id),
    ...(picture ? { picture } : {}),
    sample: false,
  };
}

/** The board's stories, newest change first ("Latest"). Merged and withdrawn stories never show. */
export const boardStories: BoardStory[] = [
  ...stories.filter((s) => s.state === 'live').map(fromExample),
  ...sampleStories.map(
    ({ story, updateTimes, latest }): BoardStory => ({
      id: story.id,
      title: story.title,
      summary: story.summary,
      locations: story.locations,
      categories: story.categories,
      updatedAt: story.updated_at,
      updateTimes,
      latest,
      takes: 0,
      sample: true,
    }),
  ),
].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** Updates in the last day, the board's stand-in for "Top" until ranking exists (step 2.3). */
export function recentUpdates(story: BoardStory, now = DESIGN_NOW): number {
  return story.updateTimes.filter((t) => now - Date.parse(t) <= 86_400_000).length;
}

/** "Top": the stories moving most, by updates in the last day and then takes. */
export const topOrder: string[] = [...boardStories]
  .sort((a, b) => recentUpdates(b) * 2 + b.takes * 3 - (recentUpdates(a) * 2 + a.takes * 3))
  .map((s) => s.id);

/** A reader's sample choices for "For you": favourite categories and a bookmark. */
export const sampleReader = {
  favourites: ['sports', 'ai'],
  bookmarks: ['01a199e9-d180-75ec-8a81-134dd403419a'],
};

export function isForYou(story: BoardStory): boolean {
  return (
    story.categories.some((c) => sampleReader.favourites.includes(c)) ||
    sampleReader.bookmarks.includes(story.id)
  );
}
