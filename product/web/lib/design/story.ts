import {
  type Creation,
  creations,
  liveUpdatesOf,
  type Picture,
  type Sourced,
  type Story,
  sourced,
  stories,
  updates,
} from './examples.ts';
import { exampleMedia, placeholderImage } from './media.ts';

/**
 * A story page's content, from the agreement's examples: the timeline (newest first, merged
 * and withdrawn updates left out, corrections tied to what they correct) and the takes from
 * all three routes, each with its credit. Read on the server only.
 */

/** Who posted a found post, as X showed it when found. */
export type XCredit = { handle: string; name?: string; url: string };

export type TimelineEntry = {
  id: string;
  headline: string;
  body?: string;
  reportedAt: string;
  /** This update corrects an earlier one. */
  corrects?: string;
  /** A later update corrects this one. */
  correctedBy?: string;
  /** The posts on X it reports, credited while they're live. */
  credits: XCredit[];
  /** The other pages it's based on. */
  sources: string[];
};

/** An account on Hrizzup, as a design sample: the agreement carries account IDs only. */
export type Account = { kind: 'hrizzup' | 'creator' | 'user'; name: string; handle?: string };

export type Take =
  | {
      route: 'found';
      id: string;
      at: string;
      credit: XCredit;
      media: 'text' | 'image' | 'video';
      summary: string;
    }
  | {
      route: 'made' | 'posted';
      id: string;
      at: string;
      author: Account;
      text?: string;
      picture?: Picture;
      /** For our own content: the found posts it builds on, credited alongside it. */
      basedOn: XCredit[];
    };

export type StoryPage = {
  story: Story;
  entries: TimelineEntry[];
  takes: Take[];
};

/** Design samples for the accounts in the examples (names are made up; IDs are the examples'). */
export const sampleAccounts: Record<string, Account> = {
  'ea644a46-e968-4af3-833d-998f3b34ac39': { kind: 'hrizzup', name: 'Hrizzup' },
  'e8285c9a-d754-468d-95a8-13e9d49fa569': {
    kind: 'creator',
    name: 'Ira Mehta',
    handle: 'ira.explains',
  },
  'e3a873d9-a55f-4bda-95b1-334ac5451ed4': {
    kind: 'creator',
    name: 'Kabir Sethi',
    handle: 'kabirbowls',
  },
  '69920382-2f22-4cb7-ac48-9877e28ea4bb': {
    kind: 'creator',
    name: 'Meher Anand',
    handle: 'meherclicks',
  },
  '26cd4de6-9e8f-49c1-a2c4-358be78ddacb': { kind: 'user', name: 'Rohan', handle: 'rohan_26' },
};

function liveCredit(id: string): XCredit | undefined {
  const item = sourced.find((s) => s.id === id);
  if (item?.state !== 'live' || !item.post) return undefined;
  return {
    handle: item.post.handle,
    ...(item.post.name ? { name: item.post.name } : {}),
    url: item.post.url,
  };
}

function pictureOf(creation: Creation): Picture | undefined {
  if (creation.image) {
    const src = exampleMedia[creation.image.key];
    return {
      kind: 'image',
      ...(src ? { src } : {}),
      width: creation.image.width,
      height: creation.image.height,
      alt: creation.image.alt,
      placeholder: placeholderImage(creation.image.placeholder),
    };
  }
  if (creation.video) {
    return {
      kind: 'video',
      width: creation.video.width,
      height: creation.video.height,
      ...(creation.video.alt ? { alt: creation.video.alt } : {}),
      ...(creation.video.placeholder
        ? { placeholder: placeholderImage(creation.video.placeholder) }
        : {}),
      seconds: creation.video.duration_seconds,
    };
  }
  return undefined;
}

function foundTake(item: Sourced): Take | undefined {
  if (item.state !== 'live' || !item.post || !item.summary) return undefined;
  return {
    route: 'found',
    id: item.id,
    at: item.post.posted_at,
    credit: {
      handle: item.post.handle,
      ...(item.post.name ? { name: item.post.name } : {}),
      url: item.post.url,
    },
    media: item.post.media as 'text' | 'image' | 'video',
    summary: item.summary,
  };
}

/** Every story the design pages can open, by ID: the examples, merged ones included. */
export const storyIds = stories.map((s) => s.id);

export function storyPage(id: string): StoryPage | undefined {
  const story = stories.find((s) => s.id === id);
  if (!story) return undefined;
  const live = liveUpdatesOf(id);
  const correctedBy = new Map(
    live.filter((u) => u.corrects).map((u) => [u.corrects as string, u.id] as const),
  );
  const entries: TimelineEntry[] = live
    .map((u) => ({
      id: u.id,
      headline: u.headline,
      ...(u.body ? { body: u.body } : {}),
      reportedAt: u.reported_at,
      ...(u.corrects ? { corrects: u.corrects } : {}),
      ...(correctedBy.has(u.id) ? { correctedBy: correctedBy.get(u.id) } : {}),
      credits: (u.based_on ?? []).map(liveCredit).filter((c): c is XCredit => Boolean(c)),
      sources: u.sources ?? [],
    }))
    .reverse();

  const found = sourced
    .filter((s) => s.kind === 'take' && s.story_ids?.includes(id))
    .map(foundTake)
    .filter((t): t is Take => Boolean(t));
  const posted: Take[] = creations
    .filter((c) => c.story_ids?.includes(id))
    .map((c) => {
      const picture = pictureOf(c);
      return {
        route: c.route,
        id: c.id,
        at: c.created_at,
        author: sampleAccounts[c.author.account_id] ?? { kind: c.author.kind, name: 'Someone' },
        ...(c.text ? { text: c.text } : {}),
        ...(picture ? { picture } : {}),
        basedOn: (c.based_on ?? []).map(liveCredit).filter((x): x is XCredit => Boolean(x)),
      };
    });
  const takes = [...found, ...posted].sort((a, b) => b.at.localeCompare(a.at));
  return { story, entries, takes };
}

/** How many updates a story has, merged and withdrawn ones left out. */
export function updateCount(id: string): number {
  return updates.filter((u) => u.story_id === id && u.state === 'live').length;
}
