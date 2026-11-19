import { randomUUID } from 'node:crypto';
import { itemWords, matches, storyWords } from '@hrizzup/social/for-you';
import {
  EMPTY_PROFILE,
  parseProfile,
  type ReadingProfile,
  writeProfile,
} from '@hrizzup/social/reading-profile';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { asBrowserCookie } from '../support/bypass.ts';
import { call } from '../support/quiet-request.ts';
import { runAddress } from '../support/run.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * The founder's done-test of Round 6's R12 (docs/social/r12-design.md, sections 3.9 and 4.6: the reader agent, its
 * reading profile and For You): a fresh reader tells the reader agent what they want to read, in a real browser, on
 * staging itself, and For You follows. Run by hand, once, from this Mac, never by the checks (a minute or two), once M3
 * is on staging, and once more after the founder adds `WORKERS_AI_TOKEN` to staging's keys, to see a real model:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-r12.spec.ts'
 * The path, as R5's, R7's and R8's go: Doppler `stg` only, no bypass cookie, no real email (the reader is a fresh run
 * account, signed in through staging's admin access), every word the run's own:
 * 1. a fresh run account, signed in in a real browser. It holds no profile, and Hrizzup's allowance for the day is
 *    read (`GET /reader`: `allowance.neuronsUsed`);
 * 2. on `/sandbox/social/reader`, one message through the page's form: "AI and crypto news, mostly timelines, no
 *    politics". The reply comes back, and the allowance read again: it grew by at least the reply's own neurons.
 *    **With no token on staging the stand-in answers ("(Stand-in, Workers AI isn't set up here.)") and spends 0
 *    neurons: the output says so and the run still passes**; with the token a model answers and the reply's neurons
 *    are above 0 and under the reservation (18.3925);
 * 3. the profile changed: it holds something now (the output prints it: it is the run's own words);
 * 4. For You, read whole through its `next`: no story matches a "Less of" item of the profile, and the stories the
 *    board holds that match "More of" are listed (at least one of them, when there are any);
 * 5. the board (`/sandbox/social`) opens on For You for this account: a 307, and a browser lands on it;
 * 6. a hand edit: on the reader page's form, "politics" goes under "Less of" (when it isn't there, so a model that
 *    left it out can't pass the check by luck) and a word of For You's first story with it; Save. For You changed, the
 *    first story is gone, and none about politics is left;
 * 7. a replay: a second message goes through the API (`POST /reader/chat`) with a request ID of the run's own, and
 *    the same request again: the same two messages answer, with no second call (the reader's own count of
 *    messages doesn't move).
 * At most three chat messages are sent in all (two here: one through the form, one through the API and its replay);
 * each of them could be a real call to Workers AI, so the number is counted and checked. The only things printed are
 * the run's own test words, the provider that answered, the neurons and the counts.
 *
 * Nothing secret or other than the run's own is printed: every request goes through support/quiet-request.ts, which
 * throws a new error naming only the method and the path, since a thrown request's call log holds the session's
 * cookies. The account is never deleted (the books keep their history).
 */

const BASE = process.env.BASE_URL ?? '';
const READER = '/sandbox/social/reader';
const FOR_YOU = '/sandbox/social/reader/for-you';
const BOARD = '/sandbox/social';
/** The most chat messages this run may send, each of which could be a real call to the AI. */
const MOST_MESSAGES = 3;
/** The most neurons one call reserves with the default settings (docs/social/r12-design.md, decision 5). */
const RESERVATION = 18_392_500n;

type Tile = {
  id: string;
  title: string;
  summary: string;
  latestHeadline: string | null;
  categories: string[];
  places: string[];
};
type State = {
  profile: string;
  holdsSomething: boolean;
  usage: {
    messagesLeftToday: number;
    messagesToday: number;
    dailyMessages: number;
    resetsAt: string;
  };
  allowance: { neuronsUsed: string; neuronsReserved: string; dailyNeurons: string; calls: number };
};
type Message = { id: string; author: 'reader' | 'agent'; body: string; neurons: string | null };
type Reply = {
  message: Message;
  reply: Message;
  profileChanged: boolean;
  profile: string;
  holdsSomething: boolean;
  usage: State['usage'];
  allowance: State['allowance'];
};

/** A value that must be there, or a failure that says what was missing. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`);
  return value;
}

/**
 * Waits until React has taken the field over (it marks each element it hydrates), so what is typed into it is kept:
 * a controlled field that is typed in before it hydrates is reset to its first value, and the page's buttons do
 * nothing until then.
 */
async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((css) => {
    const field = document.querySelector(css);
    return field !== null && Object.keys(field).some((key) => key.startsWith('__reactProps'));
  }, selector);
}

/** A decimal text as a whole number of millionths, so two are compared exactly, never as floats. */
function millionths(text: string): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

/** What an answer says about a refusal, for a failure's message: the reason and the words (the API's, never a secret). */
const why = (answer: { body: Record<string, unknown> }) =>
  JSON.stringify({ data: answer.body.data, message: answer.body.message });

const stateOf = async (as: APIRequestContext): Promise<State> => {
  const answer = await call(as, 'GET', '/api/v1/reader');
  expect(answer.status, `GET /reader: ${why(answer)}`).toBe(200);
  return answer.body as unknown as State;
};

/** Every story of the reader's For You, through its `next`, in order. */
async function forYouOf(
  as: APIRequestContext,
): Promise<{ ids: string[]; tiles: Map<string, Tile> }> {
  const ids: string[] = [];
  const tiles = new Map<string, Tile>();
  let cursor: string | null = null;
  for (let pages = 0; pages < 6; pages++) {
    const query: URLSearchParams = new URLSearchParams({ limit: '100' });
    if (cursor !== null) query.set('cursor', cursor);
    const answer = await call(as, 'GET', `/api/v1/reader/for-you?${query}`);
    expect(answer.status, `GET /reader/for-you: ${why(answer)}`).toBe(200);
    const body = answer.body as { stories: Tile[]; next: string | null };
    for (const story of body.stories) {
      ids.push(story.id);
      tiles.set(story.id, story);
    }
    if (body.next === null) break;
    cursor = body.next;
  }
  return { ids, tiles };
}

/** The profile as lists: what the API answered always parses (it is the one stored form). */
function profileOf(text: string): ReadingProfile {
  const parsed = parseProfile(text);
  if (!parsed.ok) throw new Error('The reader’s profile did not parse');
  return parsed.profile;
}

/** Whether a story matches any of the items, as For You reads it (its words, never plain string search). */
const matchesAny = (tile: Tile, items: readonly string[]): boolean => {
  const words = storyWords(tile);
  return items.some((item) => matches(item, words));
};

/** The words of a story fit to be a profile item: plain letters and digits, long enough to mean something, longest first. */
const usableWords = (tile: Tile): string[] =>
  [...storyWords(tile)]
    .filter((word) => /^[a-z0-9]{4,30}$/.test(word) && itemWords(word).length === 1)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

test("R12's done-test: a reader tells the reader agent what they want, the profile changes, For You follows, the board opens on it, a hand edit and a replay, on staging", async ({
  browser,
  playwright,
}) => {
  test.setTimeout(600_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");
  let sent = 0;

  // ---- 1. A fresh reader, signed in without an email ----
  const email = runAddress(`r12-${randomUUID().slice(0, 4)}`, 'chromium');
  const session = await sessionFor(keys, email, { create: true });
  const cookies = session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value));
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    storageState: { cookies, origins: [] },
  });
  // The same session for the calls that go over HTTP, as any client makes them.
  const as = await playwright.request.newContext({
    baseURL: BASE,
    storageState: { cookies, origins: [] },
  });
  try {
    const page = await context.newPage();
    const start = await stateOf(as);
    expect(start.holdsSomething, 'a fresh reader holds nothing').toBe(false);
    expect(start.profile).toBe(EMPTY_PROFILE);
    expect(start.usage.messagesToday).toBe(0);
    console.log(
      `R12 done-test: Hrizzup's day starts at ${start.allowance.neuronsUsed} of ${start.allowance.dailyNeurons} neurons used`,
    );

    // ---- 2. One message through the page's form ----
    const opened = await page.goto(READER);
    expect(opened?.status(), 'the reader agent page').toBe(200);
    const message = 'AI and crypto news, mostly timelines, no politics';
    await hydrated(page, '#reader-message');
    await page.locator('#reader-message').fill(message);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    sent++;
    const said = page.getByTestId('reader-chat-answer');
    await expect(said, 'the reader agent answers within a minute and a half').toBeVisible({
      timeout: 90_000,
    });
    expect(
      await said.getAttribute('data-ok'),
      `the message went through: ${(await said.textContent()) ?? ''}`,
    ).toBe('true');
    const chat = await call(as, 'GET', '/api/v1/reader/chat');
    expect(chat.status).toBe(200);
    const messages = (chat.body as { messages: Message[] }).messages;
    const reply = must(
      messages.find((m) => m.author === 'agent'),
      'the agent’s reply',
    );
    expect(
      messages.find((m) => m.author === 'reader')?.body,
      'the reader’s message is kept as sent',
    ).toBe(message);
    const standIn = reply.body.startsWith("(Stand-in, Workers AI isn't set up here.)");
    const neurons = must(reply.neurons, 'the reply’s neurons');
    expect(neurons, 'neurons are decimal text').toMatch(/^\d+(\.\d+)?$/);
    if (standIn) {
      expect(neurons, 'the stand-in spends no neurons').toBe('0');
    } else {
      expect(millionths(neurons), 'a real call used some neurons').toBeGreaterThan(0n);
      expect(millionths(neurons), 'and fewer than the reservation').toBeLessThan(RESERVATION);
    }
    const afterFirst = await stateOf(as);
    expect(
      millionths(afterFirst.allowance.neuronsUsed) - millionths(start.allowance.neuronsUsed),
      'Hrizzup’s count grew by at least what the reply used',
    ).toBeGreaterThanOrEqual(millionths(neurons));
    expect(afterFirst.usage.messagesToday, 'one message counted').toBe(1);
    console.log(
      standIn
        ? `R12 done-test: the stand-in answered (Workers AI is not set up on staging yet): the reply used 0 neurons, so the allowance's count did not move from ${start.allowance.neuronsUsed}`
        : `R12 done-test: Workers AI answered: the reply used ${neurons} neurons; the allowance's count went from ${start.allowance.neuronsUsed} to ${afterFirst.allowance.neuronsUsed}`,
    );

    // ---- 3. The profile changed ----
    expect(afterFirst.holdsSomething, 'the reader agent put something in the profile').toBe(true);
    expect(afterFirst.profile, 'the profile is no longer empty').not.toBe(EMPTY_PROFILE);
    const profile = profileOf(afterFirst.profile);
    console.log(`R12 done-test: the profile now holds:\n${afterFirst.profile}`);
    await page.goto(READER);
    await expect(page.locator('#reader-profile')).toHaveValue(afterFirst.profile);

    // ---- 4. For You follows the profile ----
    const board = await call(as, 'GET', '/api/v1/social/board?limit=100');
    expect(board.status, 'the board').toBe(200);
    const boardStories = (board.body as { stories: Tile[] }).stories;
    const forYou = await forYouOf(as);
    const stories = [...forYou.tiles.values()];
    expect(
      stories.filter((story) => matchesAny(story, profile.less)),
      'no story of For You matches a "Less of" item',
    ).toEqual([]);
    const wanted = boardStories.filter(
      (story) => matchesAny(story, profile.more) && !matchesAny(story, profile.less),
    );
    if (wanted.length > 0) {
      expect(
        wanted.filter((story) => forYou.tiles.has(story.id)).length,
        'the board’s stories that match "More of" are listed in For You',
      ).toBeGreaterThan(0);
    }
    console.log(
      `R12 done-test: For You holds ${forYou.ids.length} stories; ${wanted.length} of the board's first 100 match "More of" and are not hidden`,
    );

    // ---- 5. The board opens on For You ----
    // The hop is read from the browser's own navigation (staging's bot challenge turns away a page request that isn't a browser's).
    const landed = await page.goto(BOARD);
    const hop = await landed?.request().redirectedFrom()?.response();
    expect(hop?.status(), 'the board redirects this reader').toBe(307);
    expect(new URL(hop?.headers().location ?? '', BASE).pathname).toBe(FOR_YOU);
    await expect(page).toHaveURL(new RegExp(`${FOR_YOU}$`));
    await expect(page.getByTestId('for-you-built')).toHaveText('Built from your reading profile');

    // ---- 6. A hand edit changes For You ----
    const first = forYou.ids[0];
    const topStory = first === undefined ? undefined : forYou.tiles.get(first);
    const extra = topStory === undefined ? undefined : usableWords(topStory)[0];
    const edited: ReadingProfile = {
      more: profile.more,
      less: [...new Set([...profile.less, 'politics', ...(extra === undefined ? [] : [extra])])],
      formats: profile.formats,
    };
    await page.goto(READER);
    await hydrated(page, '#reader-profile');
    await page.locator('#reader-profile').fill(writeProfile(edited));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('reader-profile-answer')).toHaveText('Saved');
    const afterEdit = await forYouOf(as);
    expect(afterEdit.ids, 'For You changed with the profile').not.toEqual(forYou.ids);
    if (first !== undefined && extra !== undefined) {
      expect(afterEdit.ids, 'the first story is gone').not.toContain(first);
    }
    expect(
      [...afterEdit.tiles.values()].filter((story) => matchesAny(story, ['politics'])),
      'no story about politics is left',
    ).toEqual([]);
    console.log(
      `R12 done-test: after the hand edit For You holds ${afterEdit.ids.length} stories (${forYou.ids.length} before)`,
    );

    // ---- 7. A replay answers the same two messages, with no second call ----
    const requestId = randomUUID();
    const body = 'less cricket';
    const firstSend = await call(as, 'POST', '/api/v1/reader/chat', { requestId, body });
    sent++;
    expect(firstSend.status, `a message through the API: ${why(firstSend)}`).toBe(201);
    const a = firstSend.body as unknown as Reply;
    const between = await stateOf(as);
    expect(between.usage.messagesToday, 'two messages counted').toBe(2);
    const replay = await call(as, 'POST', '/api/v1/reader/chat', { requestId, body });
    expect(replay.status, `the same request again: ${why(replay)}`).toBe(201);
    const b = replay.body as unknown as Reply;
    expect(b.message.id, 'the same message').toBe(a.message.id);
    expect(b.reply.id, 'the same reply').toBe(a.reply.id);
    expect(b.reply.body, 'the same words').toBe(a.reply.body);
    expect(b.reply.neurons, 'the same neurons').toBe(a.reply.neurons);
    const afterReplay = await stateOf(as);
    expect(afterReplay.usage.messagesToday, 'the replay used no message').toBe(2);
    expect(afterReplay.profile, 'and changed nothing').toBe(between.profile);
    // The same request ID with another body is refused, never answered as the first.
    const reused = await call(as, 'POST', '/api/v1/reader/chat', {
      requestId,
      body: 'more cricket',
    });
    expect(reused.status, 'a request ID used with another message').toBe(409);
    expect(sent, 'a message is a call to the AI: no more than three').toBeLessThanOrEqual(
      MOST_MESSAGES,
    );
    console.log(
      `R12 done-test: the replay answered the same two messages; ${sent} chat messages were sent in all (at most ${MOST_MESSAGES}), and the reader's count is ${afterReplay.usage.messagesToday} of ${afterReplay.usage.dailyMessages}`,
    );
  } finally {
    await as.dispose();
    await context.close();
  }
});
