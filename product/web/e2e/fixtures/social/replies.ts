import { randomUUID } from 'node:crypto';
import { AGENT_FIXTURE_HANDLE } from './agents.ts';
import type { SocialFixture, SocialFixtureContext } from './fixture.ts';

/**
 * The fixture the checks keep for the social sandbox's replies area (R7; docs/social/r7-design.md, decision
 * 13 and section 3, rule 13): "screen check thread", made once on staging and found again on every run after,
 * so the screen and speed checks have a real desk with a post, its replies and their counts to open
 * (`e2e/pages/social/replies.ts`, M3).
 *
 * - **What it holds:** R7's own unlisted test story (`REPLIES_FIXTURE_STORY`) with one update, and on it one
 *   sourced text post by the fixture agent `screen_check_v1` and four replies: an `ask` under the post, an
 *   `answer` under the ask, an `add` under the answer (the third level, so the desk shows "Replies to this")
 *   and a `push-back` under the post. R5's board fixture keeps its empty desk: this is another story.
 * - **How it is made:** the story and its update are saved as the console's admin test account, unlisted. The
 *   admin owns the fixture agent (the agents fixture claimed it), so it lists the agent's keys, revokes every
 *   live one named `screen-check-thread` (left by a run that stopped), and makes one. With that key the agent
 *   posts and replies, each with a fixed request ID, so a retry, or another run at the same moment, replays a
 *   step and never repeats it. The key is revoked in a `finally`, whatever happened.
 * - **When it is done:** a signed-out read of the story's desk lists a post by the agent whose top level holds
 *   two replies. Nothing is written then.
 * - **A step another run is in the middle of** (401 a key revoked under it, 404 nothing there yet, 409 a save
 *   at the same moment, 429 a limit; and, making the key only, 422 the agent's two keys in use) waits 5 seconds
 *   and starts again from the top, for up to 90 seconds; then it throws, saying what each step last answered.
 * - **Nothing secret is ever shown:** the key goes from one answer to the next call and nowhere else; an error
 *   names the step and the status, never an answer.
 */

/** R7's unlisted test story: a version 7 UUID of the fixtures' own prefix, which nothing else uses. */
export const REPLIES_FIXTURE_STORY = '019a6c00-0000-7000-8000-0000000000c1';
/** Its one update. */
export const REPLIES_FIXTURE_UPDATE = '019a6c00-0000-7000-8000-0000000000c2';
/** The name of the key the fixture makes: a stale one is found by it. */
export const REPLIES_FIXTURE_KEY_NAME = 'screen-check-thread';

/** Each write's request ID: fixed, so a second run replays a step and never repeats it. */
export const REPLIES_FIXTURE_REQUESTS = {
  post: '5c0e0a22-0001-4000-8000-000000000001',
  ask: '5c0e0a22-0002-4000-8000-000000000002',
  answer: '5c0e0a22-0003-4000-8000-000000000003',
  add: '5c0e0a22-0004-4000-8000-000000000004',
  pushBack: '5c0e0a22-0005-4000-8000-000000000005',
} as const;

export const REPLIES_FIXTURE_TITLE =
  'Screen check: a test story kept on staging for the thread and its replies';
const SUMMARY =
  "A test story for the sandbox's thread checks, on staging only. It is unlisted, so it never shows on the board, and made once by the screen check's admin test account.";
const HEADLINE = 'A test development in the kept story, with a post and replies on its desk';
const SOURCE = 'https://example.com/sources/replies-fixture';
const MADE_AT = '2026-11-18T05:00:00.000Z';
const REPORTED_AT = '2026-11-18T05:30:00.000Z';

/** The post and its four replies, in the order they are made. */
export const REPLIES_FIXTURE_WORDS = {
  post: 'A sourced take for the thread checks, kept on staging. Not a real take.',
  ask: 'Which source says so? A link would help.',
  answer: 'The source is linked here: the first update of this test story.',
  add: 'One more fact, a third level down, so the desk shows where the thread goes on.',
  pushBack: 'That claim needs more than one source, so this reply pushes back on it.',
} as const;

const WAIT_MS = 5_000;
const GIVE_UP_MS = 90_000;

/** What a fixture is made with: the world's fetch, sleep, clock and request IDs, so a test can stand in for them. */
export type RepliesFixtureWorld = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** A new request ID for the key (never a fixed one: a replay would hand back a key that is gone). */
  newId?: () => string;
};

/** The answers that mean "another run is partway": try again from the top. */
const AGAIN = new Set([401, 404, 409, 429]);

/** The steps, in the order a pass makes them: what the give-up message names. */
const STEPS = [
  'desk',
  'replies',
  'story',
  'update',
  'keys',
  'revoke',
  'key',
  'post',
  'ask',
  'answer',
  'add',
  'push-back',
] as const;
type Step = (typeof STEPS)[number];

/** The headers without the session: the bypass for a protected preview stays, and no one is signed in. */
function signedOut(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'cookie'),
  );
}

/** A story/1 record of the fixture: live, made at a fixed time in the past, so a second save is the same record. */
const storyRecord = () => ({
  format: 'story/1',
  id: REPLIES_FIXTURE_STORY,
  title: REPLIES_FIXTURE_TITLE,
  summary: SUMMARY,
  locations: ['mumbai'],
  categories: ['general'],
  state: 'live',
  created_at: MADE_AT,
  updated_at: MADE_AT,
});

/** The story's one update, as an update/1 record. */
const updateRecord = () => ({
  format: 'update/1',
  id: REPLIES_FIXTURE_UPDATE,
  story_id: REPLIES_FIXTURE_STORY,
  headline: HEADLINE,
  reported_at: REPORTED_AT,
  sources: [SOURCE],
  state: 'live',
  created_at: REPORTED_AT,
  updated_at: REPORTED_AT,
});

/** A text answer's JSON, or null when it isn't JSON: the status says what happened. */
async function jsonOf(answer: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await answer.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether a save went through, or the database already had what it was sent. */
const saved = async (answer: Response): Promise<boolean> =>
  answer.status === 200 ||
  (answer.status === 409 &&
    ((await jsonOf(answer))?.data as { reason?: unknown } | undefined)?.reason === 'stale_record');

/**
 * Makes the thread fixture if it isn't there: the story and its update saved as the admin, then, with a key of
 * the fixture agent's own that lasts only as long as this, one post and four replies. Finds it again if it is.
 */
export async function ensureRepliesFixture(
  { baseURL, headers }: SocialFixtureContext,
  world: RepliesFixtureWorld = {},
): Promise<void> {
  const send = world.fetch ?? fetch;
  const sleep =
    world.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = world.now ?? Date.now;
  const newId = world.newId ?? randomUUID;
  const started = now();
  const open = signedOut(headers);

  /** Each step's last answer, by its status only: what the give-up message says, never an answer's body. */
  const last = new Map<Step, number>();
  const call = (step: Step, path: string, as: Record<string, string>, body?: unknown) =>
    send(new URL(path, baseURL), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? as : { ...as, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).then(
      (answer) => {
        last.set(step, answer.status);
        return answer;
      },
      () => {
        throw new Error(`The thread fixture's ${step} did not reach the site`);
      },
    );
  const refused = (step: Step, answer: Response) =>
    new Error(`The thread fixture's ${step} answered ${answer.status}`);
  /** Whether a step's answer means another run is partway: a key is also refused (422) while the agent's two keys are in use. */
  const partway = (step: Step, answer: Response) =>
    AGAIN.has(answer.status) || (step === 'key' && answer.status === 422);

  /** The desk's post by the fixture agent and how many replies sit at its top level; null when no such post. */
  async function lookup(): Promise<{ done: boolean } | 'no-story'> {
    const desk = await call('desk', `/api/v1/social/stories/${REPLIES_FIXTURE_STORY}/posts`, open);
    if (desk.status === 404) return 'no-story';
    if (desk.status !== 200) throw refused('desk', desk);
    const posts = ((await jsonOf(desk))?.posts ?? []) as {
      id?: unknown;
      agent?: { handle?: unknown };
    }[];
    const mine = posts.find(
      (post) => post.agent?.handle === AGENT_FIXTURE_HANDLE && typeof post.id === 'string',
    );
    if (mine === undefined) return { done: false };
    const thread = await call('replies', `/api/v1/social/posts/${String(mine.id)}/replies`, open);
    if (thread.status === 404) return { done: false };
    if (thread.status !== 200) throw refused('replies', thread);
    const replies = ((await jsonOf(thread))?.replies ?? []) as unknown[];
    return { done: replies.length >= 2 };
  }

  /** One pass from step 1: whether the fixture is there at the end. A step another run is in the middle of answers "not yet". */
  async function pass(): Promise<boolean> {
    const found = await lookup();
    if (found !== 'no-story' && found.done) return true;

    const story = await call('story', '/api/v1/admin/social/stories', headers, {
      record: storyRecord(),
      listed: false,
    });
    if (!(await saved(story))) {
      if (partway('story', story)) return false;
      throw refused('story', story);
    }
    const update = await call('update', '/api/v1/admin/social/updates', headers, {
      record: updateRecord(),
    });
    if (!(await saved(update))) {
      if (partway('update', update)) return false;
      throw refused('update', update);
    }

    // The admin owns the agent: a key left by a run that stopped is revoked first, then one of this pass's own.
    const listed = await call('keys', '/api/v1/owner/agent/keys', headers);
    if (partway('keys', listed)) return false;
    if (listed.status !== 200) throw refused('keys', listed);
    const stale = (((await jsonOf(listed))?.keys ?? []) as { id?: unknown; name?: unknown }[])
      .filter((key) => key.name === REPLIES_FIXTURE_KEY_NAME && typeof key.id === 'string')
      .map((key) => String(key.id));
    for (const id of stale) {
      const gone = await call('revoke', `/api/v1/owner/agent/keys/${id}/revoke`, headers, {});
      if (partway('revoke', gone)) return false;
      if (gone.status !== 200) throw refused('revoke', gone);
    }
    const made = await call('key', '/api/v1/owner/agent/keys', headers, {
      requestId: newId(),
      name: REPLIES_FIXTURE_KEY_NAME,
    });
    if (partway('key', made)) return false;
    if (made.status !== 201) throw refused('key', made);
    const body = await jsonOf(made);
    const keyId = (body?.key as { id?: unknown } | undefined)?.id;
    const secret = body?.secret;
    if (typeof keyId !== 'string' || typeof secret !== 'string') {
      throw new Error("The thread fixture's key gave no key");
    }

    try {
      const as = { ...open, authorization: `Bearer ${secret}` };
      /** One write with the fixture's own key; its answer's `id`, or null when another run is partway. */
      const write = async (step: Step, path: string, payload: Record<string, unknown>) => {
        const answer = await call(step, path, as, payload);
        if (partway(step, answer)) return null;
        if (answer.status !== 201) throw refused(step, answer);
        const id = (await jsonOf(answer))?.id;
        if (typeof id !== 'string') throw new Error(`The thread fixture's ${step} gave no ID`);
        return id;
      };
      const reply = (
        step: Step,
        request: string,
        post: string,
        parent: string | null,
        intent: string,
        words: string,
      ) =>
        write(step, '/api/v1/social/me/replies', {
          requestId: request,
          postId: post,
          ...(parent === null ? {} : { parentId: parent }),
          intent,
          body: words,
          sources: [SOURCE],
        });

      const post = await write('post', '/api/v1/social/me/posts', {
        requestId: REPLIES_FIXTURE_REQUESTS.post,
        storyId: REPLIES_FIXTURE_STORY,
        kind: 'text',
        body: REPLIES_FIXTURE_WORDS.post,
        sources: [SOURCE],
        afterUpdateId: REPLIES_FIXTURE_UPDATE,
      });
      if (post === null) return false;
      const ask = await reply(
        'ask',
        REPLIES_FIXTURE_REQUESTS.ask,
        post,
        null,
        'ask',
        REPLIES_FIXTURE_WORDS.ask,
      );
      if (ask === null) return false;
      const answer = await reply(
        'answer',
        REPLIES_FIXTURE_REQUESTS.answer,
        post,
        ask,
        'answer',
        REPLIES_FIXTURE_WORDS.answer,
      );
      if (answer === null) return false;
      const add = await reply(
        'add',
        REPLIES_FIXTURE_REQUESTS.add,
        post,
        answer,
        'add',
        REPLIES_FIXTURE_WORDS.add,
      );
      if (add === null) return false;
      const pushBack = await reply(
        'push-back',
        REPLIES_FIXTURE_REQUESTS.pushBack,
        post,
        null,
        'push-back',
        REPLIES_FIXTURE_WORDS.pushBack,
      );
      if (pushBack === null) return false;
    } finally {
      // The key is revoked whatever happened: it never outlives the pass. A failure to revoke is no new
      // failure (a stale key is revoked first by the next run), and never hides the one that came first.
      await call('revoke', `/api/v1/owner/agent/keys/${keyId}/revoke`, headers, {}).catch(
        () => undefined,
      );
    }
    return true;
  }

  for (;;) {
    if (await pass()) return;
    if (now() - started >= GIVE_UP_MS) {
      const answers = STEPS.filter((step) => last.has(step))
        .map((step) => `${step} ${last.get(step)}`)
        .join(', ');
      throw new Error(
        `The thread fixture isn't on this site after 90 seconds (last answers: ${answers}). ` +
          "A 404 on the desk means this site doesn't show it: check that it serves social.stories.posts and " +
          'social.posts.replies (a dev server or preview older than its branch answers "No such call") and uses ' +
          "staging's database, where the admin test account owns the fixture agent " +
          `${AGENT_FIXTURE_HANDLE} and its two keys.`,
      );
    }
    await sleep(WAIT_MS);
  }
}

export const repliesFixtures: readonly SocialFixture[] = [
  { name: 'screen check thread', ensure: (context) => ensureRepliesFixture(context) },
];
