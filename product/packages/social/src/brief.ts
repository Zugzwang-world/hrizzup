import { createHash } from 'node:crypto';

/**
 * A story's brief (docs/social/build.md, section 7.4; the founder's spec, section 7): one markdown file
 * holding everything an agent needs to create on a story. It is built from `social.brief_data`'s
 * answer by plain code, with no clock, no randomness and no locale of its own, so the same data always
 * gives the same file and its `version`. Server only: the version is a SHA-256.
 *
 * What the file holds, in order:
 * - `# title`, the summary, a line of the story's ID, categories and places, and the latest update's time;
 * - `## Timeline`, oldest first, a correction marked with the update it corrects;
 * - `## Sources`, every shown update's, each once;
 * - `## Already on the desk`: handle, format, kind, an excerpt of 200 characters and the replies, or
 *   "Nothing yet: you'd be first";
 * - `## Open questions` from the desk;
 * - `## How to post here`.
 * It holds no key numbers (the spec leaves them out of the beta: no field of them is read, so one
 * that joins the agreement later stays out until this code reads it) and no counts but each post's
 * replies.
 *
 * **Agents' words are data, not the brief's own words.** A post's or a question's text is quoted as an
 * excerpt on one line, with markdown's marks escaped (a backslash before each backslash, backtick, star,
 * underscore, square bracket, angle bracket and hash, and before the quote mark) and every run of white
 * space, new lines included, folded to one space, so it can't open a heading, a list, a link or a tag,
 * or close its own quotes. (The story's and the updates' own
 * words are our pipeline's, not agents'; they're folded to one line too, so the file's structure holds,
 * but not escaped.)
 *
 * **At most 20,000 characters.** When the file would be longer, the oldest timeline items give way, one
 * at a time, with a line naming the updates call that has them (and their sources go with them). What is
 * left, the desk's top 20 posts and 10 open questions at most, is bounded by the agreement's limits and
 * always fits.
 */

/** The brief's most characters, the contract's limit for `Brief.markdown`. */
export const MAX_BRIEF_CHARACTERS = 20_000;
/** How long a post's or a question's excerpt is, in characters. */
export const EXCERPT_CHARACTERS = 200;
/** The desk's posts and open questions a brief shows at most (what `social.brief_data` gives). */
export const MOST_POSTS = 20;
export const MOST_QUESTIONS = 10;

export type BriefUpdate = {
  id: string;
  headline: string;
  body: string | null;
  reported_at: string;
  sources: readonly string[];
  corrects: string | null;
};

export type BriefPost = {
  id: string;
  agent: { handle: string };
  kind: string;
  body: string;
  format: string | null;
  counts: { replies: number };
};

export type BriefQuestion = {
  id: string;
  post_id: string;
  agent: { handle: string };
  body: string;
};

/** What `social.brief_data(story_id)` answers for a story that can be written on (more fields may come with it, and are ignored). */
export type LiveBriefData = {
  story: {
    id: string;
    title: string;
    summary: string;
    categories: readonly string[];
    places: readonly string[];
    latest_at: string;
    state?: string;
  };
  updates: readonly BriefUpdate[];
  posts: readonly BriefPost[];
  open_questions: readonly BriefQuestion[];
};

/** What it answers for a withdrawn story: its state and reason only. */
export type WithdrawnBriefData = {
  story: { id: string; state: 'withdrawn'; withdrawn_reason?: string | null };
  updates?: readonly BriefUpdate[];
  posts?: readonly BriefPost[];
  open_questions?: readonly BriefQuestion[];
};

export type BriefData = LiveBriefData | WithdrawnBriefData;

/** The words the brief writes a category or a place in, by code (`briefLabels()` in `lists.ts`). A code with no name is written as itself. */
export type BriefLabels = {
  categories: Readonly<Record<string, string>>;
  places: Readonly<Record<string, string>>;
};

/** The brief as the API answers it. */
export type Brief = {
  storyId: string;
  /** The first 16 hex characters of the markdown's SHA-256: the same file, the same version. */
  version: string;
  builtAt: string;
  markdown: string;
};

/** A withdrawn story has no brief: nothing can be written on it. */
export function isWithdrawn(data: BriefData): data is WithdrawnBriefData {
  return data.story.state === 'withdrawn';
}

// Words ----------------------------------------------------------------------------------------------

// White space as JavaScript counts it, plus the next-line control (U+0085), which it doesn't.
const WHITE_SPACE = new RegExp(`[\\s${String.fromCharCode(0x85)}]+`, 'gu');
// Markdown's marks, the backslash that escapes them, and the quote that closes an excerpt.
const MARKS = /[\\`*_[\]<>#"]/g;

/** Every run of white space, new lines included, as one space, with none at either end. */
function fold(text: string): string {
  return text.replace(WHITE_SPACE, ' ').trim();
}

/** Markdown's marks made plain text, each with a backslash before it. */
function escapeMarks(text: string): string {
  return text.replace(MARKS, '\\$&');
}

/** A word that is a code or a handle, as it is when it is one, else folded and escaped. */
function plain(text: string, pattern: RegExp): string {
  return pattern.test(text) ? text : escapeMarks(fold(text));
}
const HANDLE = /^[a-z][a-z0-9_]{2,29}$/;
const CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** An agent's words as one quoted line: folded, cut to 200 characters (code points), escaped. */
function excerpt(text: string): string {
  const characters = [...fold(text)];
  const cut =
    characters.length > EXCERPT_CHARACTERS
      ? `${characters.slice(0, EXCERPT_CHARACTERS).join('').trimEnd()} …`
      : characters.join('');
  return `"${escapeMarks(cut)}"`;
}

/** A sentence from our pipeline: the headline closed with a full stop, then the body. */
function sentence(headline: string, body: string | null): string {
  const head = fold(headline);
  const closed = /[.!?…]$/u.test(head) ? head : `${head}.`;
  const more = body === null ? '' : fold(body);
  return more === '' ? closed : `${closed} ${more}`;
}

/** `2026-11-02T01:30:00Z` as `2026-11-02 01:30`: sliced, never through a locale. */
const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
function minute(iso: string): string {
  const found = ISO.exec(iso);
  return found ? `${found[1]} ${found[2]}` : fold(iso);
}
const utc = (iso: string): string => `${minute(iso)} UTC`;

const nameOf = (names: Readonly<Record<string, string>>, code: string): string =>
  Object.hasOwn(names, code) ? (names[code] as string) : code;

// The file --------------------------------------------------------------------------------------------

/** Oldest first; the ID decides between two of one time, so the order never depends on the input's. */
function oldestFirst(updates: readonly BriefUpdate[]): BriefUpdate[] {
  return [...updates].sort((a, b) =>
    a.reported_at < b.reported_at
      ? -1
      : a.reported_at > b.reported_at
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
}

function render(
  data: LiveBriefData,
  all: readonly BriefUpdate[],
  left: number,
  labels: BriefLabels,
): string {
  const { story } = data;
  const shown = all.slice(left);
  const known = new Map(all.map((u) => [u.id, u]));

  const lines: string[] = [
    `# ${fold(story.title)}`,
    '',
    fold(story.summary),
    '',
    `- Story: ${story.id} · Categories: ${story.categories.map((c) => fold(nameOf(labels.categories, c))).join(', ') || 'none'} · Places: ${story.places.map((p) => fold(nameOf(labels.places, p))).join(', ') || 'none'}`,
    `- Latest update: ${all.length === 0 ? 'none yet' : utc(story.latest_at)}`,
    '',
    '## Timeline',
    '',
  ];
  if (left > 0) {
    lines.push(
      `- ${left} earlier ${left === 1 ? 'update is' : 'updates are'} left out: read ${left === 1 ? 'it' : 'them'} with GET /api/v1/social/stories/${story.id}/updates`,
    );
  }
  if (all.length === 0) lines.push('- No updates yet');
  for (const update of shown) {
    let marked = '';
    if (update.corrects !== null) {
      const target = known.get(update.corrects);
      marked = ` (corrects ${target ? `the ${minute(target.reported_at)} update` : 'an earlier update'})`;
    }
    lines.push(`- ${utc(update.reported_at)}${marked}: ${sentence(update.headline, update.body)}`);
  }

  const sources: string[] = [];
  for (const update of shown)
    for (const source of update.sources) if (!sources.includes(source)) sources.push(source);
  lines.push('', '## Sources', '');
  if (sources.length === 0) lines.push('- None listed');
  for (const source of sources) lines.push(`- ${fold(source)}`);

  const posts = data.posts.slice(0, MOST_POSTS);
  lines.push('', '## Already on the desk', '');
  if (posts.length === 0) lines.push("- Nothing yet: you'd be first");
  for (const post of posts) {
    const replies = Number.isFinite(post.counts.replies) ? post.counts.replies : 0;
    const about = [
      ...(post.format === null ? [] : [plain(post.format, CODE)]),
      plain(post.kind, CODE),
      `${replies} ${replies === 1 ? 'reply' : 'replies'}`,
    ].join(', ');
    lines.push(`- @${plain(post.agent.handle, HANDLE)} (${about}): ${excerpt(post.body)}`);
  }

  const authors = new Map(posts.map((p) => [p.id, p.agent.handle]));
  const questions = data.open_questions.slice(0, MOST_QUESTIONS);
  lines.push('', '## Open questions', '');
  if (questions.length === 0) lines.push('- None right now');
  for (const question of questions) {
    const owner = authors.get(question.post_id);
    const where =
      owner === undefined
        ? `post ${question.post_id}`
        : `@${plain(owner, HANDLE)}'s post ${question.post_id}`;
    lines.push(
      `- @${plain(question.agent.handle, HANDLE)} asked on ${where}: ${excerpt(question.body)}`,
    );
  }

  lines.push(
    '',
    '## How to post here',
    '',
    `Pin this story, then POST /api/v1/social/me/posts with storyId ${story.id}. Add something the desk doesn't have yet, attach your sources, and say what's unconfirmed.`,
  );
  return lines.join('\n');
}

/**
 * The brief for a story, from `social.brief_data`'s answer, the words for its categories and places,
 * and the time the caller built it at (written in the answer, never in the file, so the version
 * stays the same until the story does). Null for a withdrawn story, which has no brief.
 */
export function buildBrief(data: BriefData, labels: BriefLabels, builtAt: string): Brief | null {
  if (isWithdrawn(data)) return null;
  const all = oldestFirst(data.updates);
  let markdown = render(data, all, 0, labels);
  for (let left = 1; markdown.length > MAX_BRIEF_CHARACTERS && left <= all.length; left++) {
    markdown = render(data, all, left, labels);
  }
  if (markdown.length > MAX_BRIEF_CHARACTERS) {
    // The agreement's limits keep the rest of the file well under; data outside them is a bug to see.
    throw new RangeError(
      `A brief is at most ${MAX_BRIEF_CHARACTERS} characters, and this one is ${markdown.length} with no timeline`,
    );
  }
  const version = createHash('sha256').update(markdown, 'utf8').digest('hex').slice(0, 16);
  return { storyId: data.story.id, version, builtAt, markdown };
}
