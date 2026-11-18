import type { social } from '@hrizzup/api';
import { ORPCError } from '@orpc/server';
import { refusalOf, sentence } from './console-forms.ts';
import { KEPT_STORY_IDS } from './fixture-ids.ts';

/**
 * What the console's "Post as Hrizzup" page (`app/console/social/post/`; docs/social/media-design.md, section 9)
 * is made of, as plain functions with no page, no session and no clock, so each rule is tested alone
 * (`console-post.test.ts`): which agents and stories the page offers and which it selects, and a refusal of any
 * of the page's calls said in words, by its `data.reason`. Server only (it reads the agreement's checker through
 * `console-forms.ts`); the browser's own part is `console-upload.ts`.
 */

/** The fields of the post form, for a refusal's problems to name (`refusalOf`). */
export const POST_FIELDS: ReadonlySet<string> = new Set([
  'agentId',
  'storyId',
  'kind',
  'body',
  'sources',
  'format',
  'description',
  'transcript',
]);

/** The fields of the form that makes Hrizzup. */
export const MAKE_FIELDS: ReadonlySet<string> = new Set(['handle', 'name', 'bio']);

/** What a refusal of the page's calls says, and whether saying the same again may work. */
export type Refusal = { error: string; problems: Record<string, string>; retry: boolean };

/** The step a refusal came from: asking for the link, saying the file is done, posting, or making an agent. */
export type Step = 'link' | 'done' | 'post' | 'make';

/** The seconds a 429 asks to wait, as a few words: "about 5 minutes", "about 3 hours". */
export function waitWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a little later';
  if (seconds < 90) return 'about a minute';
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

/** What each coded refusal means for the person at the console; one a step words differently is in `BY_STEP`. */
const REASONS: Record<string, string> = {
  story_not_live: 'That story was withdrawn, so nothing can be posted on it: choose another.',
  retired:
    "This agent is retired, so it can't post or take uploads any more: a new one needs another handle.",
  media_not_ready: "The file isn't ready: press Preview again.",
  media_in_use: 'That file is already in a post: press Preview again to send it anew.',
  media_not_yours: 'That file belongs to another agent: press Preview again to send it anew.',
  still_needed: 'A video or audio needs its still image: choose one, then press Preview.',
  still_not_ready: "The still image isn't ready: press Preview again.",
  transcript_needed: 'A video or audio needs its transcript: type the words it says.',
  media_checking: 'The file is still being checked: press Preview again in a minute.',
  handle_taken: 'That handle is taken: type another one.',
  clash: 'This clashed with something saved at the same moment: press Preview again.',
};

/** Reasons said differently by the step that met them. */
const BY_STEP: Partial<Record<Step, Record<string, string>>> = {
  link: {
    media_kind:
      "That type of file isn't taken for this kind: pictures are JPEG, PNG or WebP, video MP4 and audio M4A or MP3.",
    media_too_big: 'Too big: pictures are at most 10 MB, video 100 MB and audio 20 MB.',
  },
  post: {
    media_kind: "That file isn't of this post's kind: choose the kind that matches it.",
  },
};

/** Whether saying the same again later may work: a check still running (a busy store is told by its status). */
const RETRIES = new Set(['media_checking']);

/** The reasons a checked file is refused with, each said in the API's own words for that file. */
const FILE_REFUSALS = new Set(['media_refused', 'media_kind', 'media_too_big', 'media_too_long']);

/**
 * Why one of the page's calls was refused, in words, with a problem under each field it names: its coded reason
 * (`data.reason`) said for the step it met it in, a limit's wait, a busy store, and, for anything else, the shared
 * `refusalOf` (the agreement's and the API's own problems under their fields, "no longer exists", a busy database).
 * `what` names the file in a refusal that says its own words (`The still image`, `The file`). Null when the call is
 * "No such call", which the action answers "not found"; anything that isn't a refusal from the API is thrown again:
 * it is ours to fix, not a line to show.
 */
export function pageRefusal(
  error: unknown,
  step: Step,
  fields: ReadonlySet<string>,
  what = 'The file',
): Refusal | null {
  if (!(error instanceof ORPCError)) throw error;
  if (error.code === 'NOT_FOUND' && error.message === 'No such call') return null;
  const data = (error.data ?? {}) as { reason?: unknown; retryAfterSeconds?: unknown };
  const reason = typeof data.reason === 'string' ? data.reason : undefined;
  const say = (words: string, retry = false): Refusal => ({
    error: words,
    problems: {},
    retry: retry || (reason !== undefined && RETRIES.has(reason)),
  });

  if (error.code === 'TOO_MANY_REQUESTS') {
    const wait = waitWords(typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 0);
    return say(
      reason === 'uploads_per_day'
        ? `This agent has used its uploads for today: it can send more in ${wait}.`
        : reason === 'posts_per_day'
          ? `This agent has posted as much as it may today: it can post again in ${wait}.`
          : `Too many requests: try again in ${wait}.`,
    );
  }
  if (error.code === 'SERVICE_UNAVAILABLE' && (step === 'link' || step === 'done')) {
    return say("Uploads aren't ready or storage is busy: press Preview again in a moment.", true);
  }
  if (
    error.code === 'REFUSED' &&
    step === 'done' &&
    reason !== undefined &&
    FILE_REFUSALS.has(reason)
  ) {
    // A file the check refused says why in its own words (the API's, for the file in question).
    return say(`${what} was refused: ${sentence(error.message)}`);
  }
  if (reason !== undefined) {
    const words = BY_STEP[step]?.[reason] ?? REASONS[reason];
    // A taken handle is told under the handle's own field.
    if (step === 'make' && reason === 'handle_taken' && words !== undefined) {
      return {
        error: 'Not made: see the line under the handle.',
        problems: { handle: words },
        retry: false,
      };
    }
    if (words !== undefined) return say(words);
  }
  const shared = refusalOf(error, {}, fields);
  if (shared === null) return null;
  return { error: shared.error ?? '', problems: shared.problems, retry: false };
}

// ---------------------------------------------------------------------------------------------
// Who to post as, and on which story
// ---------------------------------------------------------------------------------------------

/** An agent as the page offers it. */
export type AgentOption = { id: string; handle: string; name: string };

/**
 * The agents the page offers and the one it selects (docs/social/media-design.md, 9.1). Every listed agent of the
 * console that is not retired is offered, and a `?as=` agent too, listed or not (the check runs' own are unlisted).
 * One is selected only when `?as=` names it, or when no `?as=` is given and exactly one is offered (Hrizzup): an
 * `?as=` that names no agent the console runs, or a retired one, selects nothing and says so, and never falls back
 * to another, so a link made for one agent can't post as a different one. The one-time form that makes Hrizzup is
 * offered when no listed agent is left that can post.
 */
export function agentChoices(
  agents: readonly Pick<social.ConsoleAgent, 'id' | 'handle' | 'name' | 'listed' | 'state'>[],
  asId: string | null,
): { options: AgentOption[]; selected: string | null; note: string | null; makeHrizzup: boolean } {
  const usable = (agent: { state: string }) => agent.state !== 'retired';
  const listed = agents.filter((agent) => agent.listed && usable(agent));
  const asked = asId === null ? undefined : agents.find((agent) => agent.id === asId);
  const options = [...listed];
  if (asked && usable(asked) && !options.some((agent) => agent.id === asked.id)) {
    options.unshift(asked);
  }
  let note: string | null = null;
  if (asId !== null && asked === undefined) {
    note = 'No agent that the console runs has that ID: choose one.';
  } else if (asked && !usable(asked)) {
    note = `@${asked.handle} is retired, so it can't post: a new agent needs another handle.`;
  }
  const retiredListed = agents.filter((agent) => agent.listed && !usable(agent));
  if (listed.length === 0 && retiredListed.length > 0 && note === null) {
    note = `Hrizzup's agent @${retiredListed[0]?.handle} is retired, so it can't post: make another with a different handle.`;
  }
  const selected =
    asId !== null
      ? asked && usable(asked)
        ? asked.id
        : null
      : listed.length === 1
        ? (listed[0]?.id ?? null)
        : null;
  return {
    options: options.map(({ id, handle, name }) => ({ id, handle, name })),
    selected,
    note,
    makeHrizzup: listed.length === 0,
  };
}

/** A story as the page offers it: its title and, where so, "(test, unlisted)". */
export type StoryOption = { id: string; label: string };

/** A story's line in the list: its title, and in brackets whether the console made it (a test) and that it is unlisted. */
export function storyLabel(story: {
  title: string;
  listed: boolean;
  madeBy: 'console' | 'pipeline';
}): string {
  const marks = [story.madeBy === 'console' ? 'test' : null, story.listed ? null : 'unlisted'];
  const shown = marks.filter((mark) => mark !== null).join(', ');
  return shown === '' ? story.title : `${story.title} (${shown})`;
}

/**
 * The stories the page offers and the one it selects: the console's newest that are live (the kept fixtures, which
 * the checks keep, left out), and a `?story=` one that isn't among them, read separately (`found`: its title, or
 * null when no story has that ID or it is withdrawn). A kept story, or an ID that names nothing, selects nothing and says so.
 */
export function storyChoices(
  stories: readonly Pick<social.ConsoleStory, 'id' | 'title' | 'listed' | 'madeBy' | 'state'>[],
  wanted: string | null,
  found: { id: string; title: string } | null,
): { options: StoryOption[]; selected: string | null; note: string | null } {
  const options = stories
    .filter((story) => story.state === 'live' && !KEPT_STORY_IDS.has(story.id))
    .map((story) => ({ id: story.id, label: storyLabel(story) }));
  if (wanted === null) return { options, selected: null, note: null };
  if (KEPT_STORY_IDS.has(wanted)) {
    return {
      options,
      selected: null,
      note: 'That story is kept for the checks: nothing is posted on it.',
    };
  }
  if (options.some((option) => option.id === wanted)) {
    return { options, selected: wanted, note: null };
  }
  if (found !== null && found.id === wanted) {
    return {
      options: [{ id: found.id, label: found.title }, ...options],
      selected: found.id,
      note: null,
    };
  }
  return {
    options,
    selected: null,
    note: 'No live story has that ID: choose one.',
  };
}

/** The line for a post on a story the checks keep, or null for any other: nothing else is asked about it first. */
export function keptPostRefusal(storyId: string): string | null {
  return KEPT_STORY_IDS.has(storyId.toLowerCase())
    ? 'That story is kept for the checks: nothing is posted on it.'
    : null;
}
