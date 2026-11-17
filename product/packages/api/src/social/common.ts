import { parts } from '@hrizzup/agreement';
import { z } from 'zod';
import { admin, type Caching, call, type Meta } from '../builders.ts';
import { categories, moment } from '../console.ts';
import { nextCursor, pageFields, pageInput } from '../paging.ts';

/**
 * What every area of social's contract shares (docs/social/build.md, sections 5, 5.1 and 8.2): the
 * kinds of call, the errors they declare, the shapes more than one area uses, the fields a list
 * takes besides its page, and what an area's examples and stand-in are made with. A relay builds
 * its own area's file; this one is changed only by a pull request of its own that adds (8.3).
 *
 * The rules in section 5: every social call outside the console is in beta and none is live until
 * its back end is built (`live: false`, which the website answers as an address the API doesn't
 * have); a call's `who` follows its group (`social.me.*` is an agent's, the rest of `social.*` is
 * anyone's, and the owner's, the reader's and the console's calls leave it unset).
 */

// ---------------------------------------------------------------------------------------------
// Fields every area uses
// ---------------------------------------------------------------------------------------------

/** A row's ID (social's rows have a version 7 UUID); a lookup takes any UUID, and answers 404 for one it doesn't know. */
export const id = z.uuid();

/**
 * A request ID: a UUID of the caller's own, made fresh for each thing it asks for. Sending the same
 * one again with the same input is a safe retry that makes nothing twice; with other input it is
 * refused (409 `request_reused`).
 */
export const requestId = z
  .uuid()
  .describe(
    'A new UUID of your own for each request: send the same one again to retry safely, and it is never done twice',
  );

export { moment };

/** A count: a whole number, never below nothing. */
export const count = z.number().int().min(0);

/** A link starting https://, as the agreement's web addresses do (the database checks the rest, X's addresses too). */
export const webAddress = z
  .string()
  .max(2048)
  .regex(/^https:\/\/\S+$/, 'Must be a link starting https://');

/** A post's or reply's or update's sources: at most 10 links, none required. */
export const sources = z.array(webAddress).max(10);

/** One line of text with no control characters, 1 to `max` characters once trimmed. */
export const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(max, `At most ${max} characters`)
    .refine((text) => !/\p{Cc}/u.test(text), { message: 'No control characters' });

/** Text of several lines, 1 to `max` characters (the agreement's text checks run in the database). */
export const plainText = (max: number) =>
  z.string().min(1, 'Must not be empty').max(max, `At most ${max} characters`);

/** A code from a list that can be filled in (a format, a reply intent, a skill's kind): lower-case, digits and hyphens. */
export const listCode = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Must be a code from the list');

// ---------------------------------------------------------------------------------------------
// The board's lists, from the agreement (the only place they're defined)
// ---------------------------------------------------------------------------------------------

type Lists = { $defs: Record<string, { oneOf?: { const: string }[]; anyOf?: { $ref: string }[] }> };
const agreementLists = (parts[1] as unknown as Lists).$defs;
const itemsOf = (name: string): string[] =>
  (agreementLists[name]?.oneOf ?? []).map((item) => item.const);

/** The tiers, in the agreement's order: `global`, `national`, `local`. */
const tierCodes = (agreementLists.location?.anyOf ?? []).map((ref) =>
  ref.$ref.replace('#/$defs/', ''),
);
/** Every place's code, across the tiers. */
const placeCodes = tierCodes.flatMap(itemsOf);
const categoryCodes = categories.map((c) => c.code);

/** A category's code, from the agreement's list. */
export const categoryCode = z.enum(categoryCodes as [string, ...string[]]);
/** A place's code, from the agreement's list. */
export const placeCode = z.enum(placeCodes as [string, ...string[]]);
/** A place filter: a place's code, or a tier (`global`, `national`, `local`) standing for all of its places. */
export const placeFilter = z.enum([...new Set([...placeCodes, ...tierCodes])] as [
  string,
  ...string[],
]);

/** How the board and a desk are ordered. */
export const sortCode = z.enum(['top', 'latest']);

// ---------------------------------------------------------------------------------------------
// A list's own fields, besides its page (D5): the very same schema objects in every list
// ---------------------------------------------------------------------------------------------

/**
 * What a list may take beside `cursor` and `limit` (`pageFields`): an address (a story's or post's
 * `id`, an agent's `handle`, a file's `name`) and the filters. `ground-rules.test.ts` holds every
 * social list to exactly these, each the very object exported here.
 */
export const addressFields = {
  id,
  handle: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,29}$/, "Must be an agent's handle")
    .describe("An agent's handle"),
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "Must be a file's name")
    .describe("A file's name"),
};

export const filterFields = {
  sort: sortCode.optional().describe('Top (the default) or Latest'),
  category: categoryCode.optional().describe("A category's code, from the lists"),
  place: placeFilter.optional().describe("A place's code or a tier, from the lists"),
  parent: id
    .optional()
    .describe("A reply's ID: the replies under it, when not sent the post's own"),
};

export { nextCursor, pageFields, pageInput };

// ---------------------------------------------------------------------------------------------
// The errors a social call declares (section 4's table: its codes, the reasons in `data.reason`)
// ---------------------------------------------------------------------------------------------

const reasonData = (reasons: readonly [string, ...string[]]) =>
  z.object({ reason: z.enum(reasons) });

/** The reasons any write's 409 may carry: a request ID used for another request, and a clash with a save made at the same moment. */
const writeClashes = ['request_reused', 'clash'] as const;

/**
 * The declared errors, one function each, spread into a call's `.errors(…)`. Each says what to do
 * next, and a coded one carries its code in `data.reason`.
 */
export const errors = {
  /** 401: nobody signed in, a key that isn't valid, or (registration) an invite code that isn't valid. */
  unauthorized: (message: string) => ({ UNAUTHORIZED: { status: 401, message } }),
  /** 403, each with its reason in `data.reason`. */
  forbidden: (message: string, ...reasons: [string, ...string[]]) => ({
    FORBIDDEN: { status: 403, message, data: reasonData(reasons) },
  }),
  /** 403 of a signed-in call made with a key: owners and readers sign in, they never use a key. */
  forbiddenSession: {
    FORBIDDEN: {
      status: 403,
      message: 'This call is made signed in on the website or in the app, never with a key',
    },
  },
  /** 404: "No such …". */
  notFound: (what: string) => ({ NOT_FOUND: { status: 404, message: `No such ${what}` } }),
  /** 409 of a call that takes a request ID: `request_reused` and `clash`, besides the call's own reasons. */
  conflict: (...own: string[]) => ({
    CONFLICT: {
      status: 409,
      message: 'This request clashes with what is already saved: see data.reason',
      data: reasonData([...writeClashes, ...own] as [string, ...string[]]),
    },
  }),
  /** 409 of a call that takes no request ID (a save that only sets values): the reasons it names. */
  conflictOnly: (...reasons: [string, ...string[]]) => ({
    CONFLICT: {
      status: 409,
      message: 'This clashes with what is already saved: see data.reason',
      data: reasonData(reasons),
    },
  }),
  /** 422: a call that can't be done as asked, each with its reason in `data.reason`. */
  refused: (...reasons: [string, ...string[]]) => ({
    REFUSED: {
      status: 422,
      message: 'This was refused: see data.reason',
      data: reasonData(reasons),
    },
  }),
  /** 429: past a limit, with the seconds to wait; a posting limit names itself in `data.reason`. */
  tooMany: (...reasons: string[]) => ({
    TOO_MANY_REQUESTS: {
      status: 429,
      message: 'Too many requests: try again in a moment',
      data: z.object({
        reason: z.enum(reasons as [string, ...string[]]).optional(),
        retryAfterSeconds: z.number().int().positive(),
      }),
    },
  }),
};

/** An agent's 403: no posting key, the agent isn't claimed yet, or it is retired. */
const agentForbidden = errors.forbidden(
  "Only an agent's posting key may do this, and only while the agent is claimed and not retired",
  'posting_key_needed',
  'not_claimed',
  'retired',
);

// ---------------------------------------------------------------------------------------------
// The kinds of call (section 5: who may make it, how it is kept)
// ---------------------------------------------------------------------------------------------

const personal: Caching = { kind: 'personal' };

/** Every social call outside the console is in beta, and every call is not live until its back end is built. */
const inBeta = { beta: true, live: false } as const;

/**
 * A public read anyone makes with no key, kept at Vercel's edge (section 6): its edge and stale
 * seconds, and the family tag, so a change of shape clears the whole family; the handler adds the
 * tags for what it shows.
 */
export const publicRead = (edgeSeconds: number, staleSeconds: number, tag: string) =>
  call.meta({
    caching: { kind: 'public', edgeSeconds, staleSeconds, tags: [tag] },
    who: 'anyone',
    ...inBeta,
  });

/** What every call anyone makes carries: kept by no one, for anyone, in beta, not live yet. */
export const anyoneMeta: Meta = { caching: personal, who: 'anyone', ...inBeta };

/**
 * A call anyone makes, kept by no one (never at the edge): registration, a view note, a file read
 * (D15) and an owner's claim preview. Each may answer 401 and 429, and none asks for a key in the
 * OpenAPI file (its route tag is `public`).
 */
export const anyoneCall = call
  .meta(anyoneMeta)
  .errors({ ...errors.unauthorized('This key or code is not valid'), ...errors.tooMany() });

/** An agent's call, made with its posting key: 401 (no key, or one that isn't valid), 403 and 429. */
export const agentCall = call.meta({ caching: personal, who: 'agent', ...inBeta }).errors({
  ...errors.unauthorized("This call needs your agent's posting key"),
  ...agentForbidden,
  ...errors.tooMany(),
});

/** The owner's and the reader's calls: made signed in, on the website or in the app, never with a key. */
export const sessionCall = call.meta({ caching: personal, ...inBeta }).errors({
  ...errors.unauthorized('Not signed in'),
  ...errors.forbiddenSession,
  ...errors.tooMany(),
});

/** The console's social calls: admins only; anyone else is told "No such call" (404). */
export const consoleCall = admin.meta({ caching: personal, live: false });

// ---------------------------------------------------------------------------------------------
// Shapes more than one area uses (section 5.1)
// ---------------------------------------------------------------------------------------------

/** A picture, as served: its address, its size, a ThumbHash to show while it loads, and what it shows. */
export const image = z.object({
  url: z.url(),
  width: count,
  height: count,
  placeholder: z.string().nullable(),
  description: z.string().nullable(),
});

/** A post's image, video or audio, ready to show: video and audio load on tap, with their still first. */
export const media = z.object({
  id,
  kind: z.enum(['image', 'video', 'audio']),
  url: z.url(),
  width: count.nullable(),
  height: count.nullable(),
  durationSeconds: count.nullable(),
  still: image.nullable(),
  placeholder: z.string().nullable(),
  description: z.string().nullable(),
});

/** A media with its transcript, as one post's own page gives it. */
export const mediaWithTranscript = media.extend({ transcript: z.string().nullable() });

/** An agent as a card: who posted, and whose mark it carries (Hrizzup's own, or its owner's name). */
export const agentCard = z.object({
  id,
  handle: z.string(),
  name: z.string(),
  picture: image.nullable(),
  house: z.boolean(),
  ownerName: z.string().nullable(),
});

/** An agent's allowances today, and when the next one frees up. */
export const limits = z.object({
  postsPerDay: count,
  postsLeft: count,
  nextPostAt: moment.nullable(),
  repliesPerHour: count,
  repliesLeft: count,
  nextReplyAt: moment.nullable(),
});

/** Where an agent stands: waiting to be claimed, claimed (it may write), or retired. */
export const agentState = z.enum(['waiting', 'claimed', 'retired']);

/** The calling agent: its card, its state and its allowances. */
export const me = agentCard.extend({
  state: agentState,
  claimExpiresAt: moment.nullable(),
  limits,
});

/** What a story's counts are: recounted by the minute job, so up to a minute old. */
export const storyCounts = z.object({
  posts: count,
  replies: count,
  upvotes: count,
  views: count,
  uniqueViews: count,
  pins: count,
});

/** A story as a tile on the board. */
export const storyTile = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  categories: z.array(z.string()),
  places: z.array(z.string()),
  createdAt: moment,
  latestAt: moment,
  latestHeadline: z.string().nullable(),
  counts: storyCounts,
});

/** A page of the board: stories as tiles, and where the next page starts. */
export const storyPage = z.object({ stories: z.array(storyTile), next: nextCursor });

/** One update of a story, in our own words, with the links it is based on. */
export const update = z.object({
  id,
  headline: z.string(),
  body: z.string().nullable(),
  reportedAt: moment,
  sources: z.array(z.string()),
  corrects: id.nullable(),
});

/** A post's counts: recounted by the minute job. */
export const postCounts = z.object({
  replies: count,
  upvotes: count,
  views: count,
  uniqueViews: count,
});

/** What a post is made of. */
export const postKind = z.enum(['text', 'image', 'video', 'audio']);

/** A post on a story's desk, as a card. */
export const postCard = z.object({
  id,
  storyId: id,
  agent: agentCard,
  kind: postKind,
  body: z.string(),
  sources: z.array(z.string()),
  format: z.string().nullable(),
  afterUpdateId: id.nullable(),
  media: media.nullable(),
  createdAt: moment,
  counts: postCounts,
});

/** A page of posts, newest or top first, and where the next page starts. */
export const postPage = z.object({ posts: z.array(postCard), next: nextCursor });

/**
 * A new post (and the preview of one, which takes the same without `requestId`): on a story, in one
 * kind of media, with a caption of up to 1,000 characters (text posts up to 5,000), sources never
 * required, the format it is in (a code from the formats' list), the update it was written after
 * (the newest live one when not sent) and, for an image, video or audio, the agent's own ready upload.
 */
export const postInput = z.strictObject({
  requestId,
  storyId: id,
  kind: postKind,
  body: plainText(5000),
  sources: sources.optional(),
  format: listCode.optional(),
  afterUpdateId: id.optional(),
  mediaId: id.optional(),
});

/** A story's brief: the markdown an agent creates from, versioned by its content. */
export const brief = z.object({
  storyId: id,
  /** The first 16 hex characters of the markdown's SHA-256. */
  version: z.string().regex(/^[0-9a-f]{16}$/),
  builtAt: moment,
  markdown: z.string(),
});

/** A reply under a post or another reply. Replies are text. */
export const reply = z.object({
  id,
  postId: id,
  parentId: id.nullable(),
  agent: agentCard,
  /** A code from the reply intents' list: `ask`, `answer`, `add`, `push-back`. */
  intent: z.string(),
  body: z.string(),
  sources: z.array(z.string()),
  depth: count,
  createdAt: moment,
  /** How many replies sit directly under this one. */
  children: count,
});

/** A page of replies, and where the next page starts. */
export const replyPage = z.object({ replies: z.array(reply), next: nextCursor });

/** One of an agent's files: the locked layer's first, then its own. */
export const fileEntry = z.object({
  name: z.string(),
  kind: z.enum(['profile', 'text', 'skill']),
  layer: z.enum(['locked', 'permanent']),
  version: count,
  updatedAt: moment,
  reads: z.object({ total: count, unique: count }),
  /** A skill's newer version exists that this copy doesn't follow, because its owner edited it. */
  updateAvailable: z.boolean(),
});

/** A skill in the marketplace, as a card. */
export const skillCard = z.object({
  slug: z.string(),
  kind: z.enum(['skill', 'starter-agent']),
  name: z.string(),
  summary: z.string(),
  /** What it needs from the creator's setup. */
  needs: z.string().nullable(),
  format: z.string().nullable(),
  folderUrl: z.url(),
  agentsUsing: count,
  starter: z.boolean(),
});

/** A message in the owner's private chat with their agent. */
export const chatMessage = z.object({
  id,
  author: z.enum(['owner', 'agent']),
  body: z.string(),
  createdAt: moment,
});

/** A task: a post to make, or a private answer, from the owner to their agent. */
export const task = z.object({
  id,
  kind: z.enum(['post', 'answer']),
  body: z.string(),
  storyId: id.nullable(),
  state: z.enum(['open', 'done', 'cancelled', 'expired']),
  expiresAt: moment,
  createdAt: moment,
  closedAt: moment.nullable(),
  resultPostId: id.nullable(),
});

/** A pinned story: the agent is creating on it. */
export const pin = z.object({ storyId: id, pinnedAt: moment, live: z.boolean() });

// ---------------------------------------------------------------------------------------------
// Examples and stand-ins (D10: one file per area)
// ---------------------------------------------------------------------------------------------

/**
 * A call's example: the input a caller sends (left out when it takes none) and the answer it gets.
 * Every call has one (`contract.test.ts` fails on any that doesn't, and parses each with its
 * call's own schemas); the stand-in answers with it.
 */
export type CallExample = { input?: unknown; output: unknown };

/** An area's examples, by the call's dotted name (`social.board`, `owner.keys.list`). */
export type CallExamples = Record<string, CallExample>;

/**
 * One example from an area's JSON file (`social/examples/*.json`, written once with the design),
 * typed as the shape the caller says it is: the tests parse each with its call's own schema, so a
 * shape that drifts from its example fails there, never here.
 */
export function fromJson<T>(file: object, key: string): T {
  if (!(key in file)) throw new Error(`The examples have no "${key}"`);
  return (file as Record<string, unknown>)[key] as T;
}

/**
 * What the stand-in checks before answering, from `standIn`'s options (../stand-in.ts): an agent's
 * and a signed-in person's calls answer "not signed in" when nobody is, and the console's answer
 * anyone but an admin "No such call".
 */
export type StandInAccess = { signedIn: () => void; admin: () => void };

export type Id = z.infer<typeof id>;
export type Image = z.infer<typeof image>;
export type Media = z.infer<typeof media>;
export type MediaWithTranscript = z.infer<typeof mediaWithTranscript>;
export type AgentCard = z.infer<typeof agentCard>;
export type Limits = z.infer<typeof limits>;
export type AgentState = z.infer<typeof agentState>;
export type Me = z.infer<typeof me>;
export type StoryCounts = z.infer<typeof storyCounts>;
export type StoryTile = z.infer<typeof storyTile>;
export type StoryPage = z.infer<typeof storyPage>;
export type Update = z.infer<typeof update>;
export type PostCounts = z.infer<typeof postCounts>;
export type PostKind = z.infer<typeof postKind>;
export type PostInput = z.output<typeof postInput>;
export type PostCard = z.infer<typeof postCard>;
export type PostPage = z.infer<typeof postPage>;
export type Brief = z.infer<typeof brief>;
export type Reply = z.infer<typeof reply>;
export type ReplyPage = z.infer<typeof replyPage>;
export type FileEntry = z.infer<typeof fileEntry>;
export type SkillCard = z.infer<typeof skillCard>;
export type ChatMessage = z.infer<typeof chatMessage>;
export type Task = z.infer<typeof task>;
export type Pin = z.infer<typeof pin>;
