import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeCursor, encodeCursor } from '@hrizzup/social/cursor';
import { itemWords, matches, storyWords } from '@hrizzup/social/for-you';
import { writeProfile } from '@hrizzup/social/reading-profile';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { layoutProblems } from '../layout.ts';
import { asBrowserCookie, type BrowserCookie } from '../support/bypass.ts';
import { fitsEverywhere } from '../support/fits-everywhere.ts';
import { call } from '../support/quiet-request.ts';
import { runAddress } from '../support/run.ts';
import { signedOutState } from '../support/states.ts';
import { type Engine, sessionFor, stagingKeys } from '../support/test-accounts.ts';
import { views } from '../viewports.ts';

/**
 * Journey: what readers see of the reader agent (docs/social/r12-design.md, sections 4.3, 4.4 and 4.6; R12's M3), over
 * HTTP as any client calls and in the browser as a reader uses it, on every pull request's preview, in Chromium and
 * WebKit. The run makes its own account and signs in with the session staging's admin access gives (no email is
 * ever sent), and every word it saves or sends is its own.
 *
 * 1. The board, before a profile: it opens on the board (no redirect), with the tabs; `GET /reader` holds nothing and
 *    the day's messages are all left. Signed out, the board has the sign-in line, and both pages their link.
 * 2. A profile that doesn't read: saved from the page's form it lists its line, and nothing is saved.
 * 3. A good profile, made from the board's own stories: with two that differ, a "Less of" word of the first and a "More
 *    of" word of the second (picked with the real `words` and `matches` of For You, over each story's full set of
 *    words, never plain string search: names and the `s`/`es` rule make that wrong); with one, a "Less of" word of it;
 *    with none, "More of cricket". Typed the lenient way (`+`, a lower-case heading, no Formats), it is saved in its one
 *    stored form, which the form then shows.
 * 4. Opening: the board answers a 307 to For You (the design's assumption, checked here with a request that doesn't
 *    follow it) and a browser lands there. Over the whole of For You, walked by its `next`: the hidden story is
 *    gone, the other is there, and For You changed. With no story to pick, it passes on the page and its line.
 * 5. The remembered choice: Board keeps the reader on the board through Latest and Top; For You forgets it. The cookie
 *    is a session cookie for `/sandbox/social` only, and is gone after For You (WebKit keeps it too).
 * 6. The cursor: a page after the first is 200; one whose build is edited is 400 with the rebuilt sentence on `cursor`.
 * 7. One chat message (Chromium only, so a check run makes at most one call to the AI), through the form. Any of these
 *    passes, each with its own checks: the reply (201: the count of messages is down by one, its neurons are decimal
 *    text of 0 or more, the allowance didn't go down); chat paused for the day (429: the pause line shows); the
 *    agent busy or not there (503: the line shows, and the count is the same or down by one). The reply's words are
 *    never compared: with no token the stand-in answers, with one a model does.
 * 8. Both signed-in pages fit at every size of the screen check: For You (story titles are public), and the reader
 *    page with its message and its profile (counts only: a problem's text is never printed there).
 *
 * Before-and-after numbers are compared only when the day's reset (`usage.resetsAt`) is the same in both reads. The
 * hand-run done-test (`e2e/done/social-r12.spec.ts`) is where a replay and the allowance's count are proven.
 * Social doesn't exist on production until launch, and staging itself is skipped (its writes only go through a
 * preview, as `social-console-saves.spec.ts`'s do).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

const FOR_YOU = '/sandbox/social/reader/for-you';
const READER = '/sandbox/social/reader';
const BOARD = '/sandbox/social';
const REBUILT = 'Your For You was rebuilt: start again from the first page';

/** The part of a tile the journey reads. */
type Tile = {
  id: string;
  title: string;
  summary: string;
  latestHeadline: string | null;
  categories: string[];
  places: string[];
};

type Usage = {
  messagesLeftToday: number;
  dailyMessages: number;
  pausedUntil: string | null;
  resetsAt: string;
};
type State = {
  profile: string;
  holdsSomething: boolean;
  usage: Usage;
  allowance: { neuronsUsed: string };
};

/** The screen check's large text, as fits-everywhere.ts sets it: the page's root text at 200%. */
const LARGE_TEXT_CSS = 'html { font-size: 200% !important; }';

/**
 * The page at every size of the screen check, as `fitsEverywhere` makes it, but reporting only how many problems
 * each size found, never their text: a problem names the element's own words, and this is the page that shows the
 * reader's own message and reply.
 */
async function fitsWithoutText(page: Page, what: string): Promise<void> {
  const found: string[] = [];
  let large: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
  try {
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      if (view.largeText && large === null)
        large = await page.addStyleTag({ content: LARGE_TEXT_CSS });
      if (!view.largeText && large !== null) {
        await large.evaluate((style) => style.parentNode?.removeChild(style));
        large = null;
      }
      const problems = await layoutProblems(page);
      if (problems.length > 0) found.push(`${view.name}: ${problems.length} problem(s)`);
    }
  } finally {
    if (large !== null)
      await large.evaluate((style) => style.parentNode?.removeChild(style)).catch(() => undefined);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  expect(found, `${what}: sizes with layout problems`).toEqual([]);
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

/** A decimal text as a whole number of millionths, so two are compared exactly (never as floats). */
function millionths(text: string): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

const stateOf = async (as: APIRequestContext): Promise<State> => {
  const answer = await call(as, 'GET', '/api/v1/reader');
  expect(answer.status, 'GET /reader').toBe(200);
  return answer.body as unknown as State;
};

/** Every story of the reader's For You, through its `next`, in order: IDs and tiles. */
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
    expect(answer.status, 'GET /reader/for-you').toBe(200);
    const body = answer.body as { stories: Tile[]; next: string | null };
    for (const story of body.stories) {
      ids.push(story.id);
      tiles.set(story.id, story);
    }
    if (body.next === null) return { ids, tiles };
    cursor = body.next;
  }
  return { ids, tiles };
}

/** A word that is a good profile item: plain ASCII letters and digits, long enough to mean something. */
const USABLE = /^[a-z0-9]{4,30}$/;

/** The words of a story the profile may use as an item, longest first (a longer word is the likelier to be the story's own). */
const usableWords = (set: ReadonlySet<string>) =>
  [...set]
    .filter((word) => USABLE.test(word) && itemWords(word).length === 1)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

type Pick = {
  /** Which of the three it is, for the log line. */
  kind: 'two stories' | 'one story' | 'no story';
  /** What is typed into the profile (the lenient way) and what it is stored as. */
  typed: string;
  stored: string;
  /** The story the profile hides, and the one it raises (when two were found). */
  hidden: Tile | null;
  raised: Tile | null;
};

/**
 * What to save, from stories that are both on the board and in For You as it stands (the candidates copy may be a
 * minute behind the board, so only a story in both is picked, and its words are For You's own tile's, which is what
 * the build reads): two that differ (a word of the first that the second's words don't match is "Less of", a word
 * of the second the first's don't match is "More of"), or one (its word is "Less of"), or none ("More of cricket").
 */
function pickProfile(board: Tile[], inForYou: Map<string, Tile>): Pick {
  const both = board
    .flatMap((story) => {
      const tile = inForYou.get(story.id);
      return tile === undefined ? [] : [tile];
    })
    .slice(0, 12);
  const sets = both.map((story) => storyWords(story));
  for (let i = 0; i < both.length; i++) {
    for (let j = 0; j < both.length; j++) {
      if (i === j) continue;
      const first = both[i] as Tile;
      const second = both[j] as Tile;
      const less = usableWords(sets[i] as Set<string>).find(
        (word) => !matches(word, sets[j] as Set<string>),
      );
      const more = usableWords(sets[j] as Set<string>).find(
        (word) => !matches(word, sets[i] as Set<string>),
      );
      if (less !== undefined && more !== undefined && less !== more) {
        return {
          kind: 'two stories',
          typed: `## more of\n* ${more}\n\n## Less of\n+ ${less}`,
          stored: writeProfile({ more: [more], less: [less], formats: [] }),
          hidden: first,
          raised: second,
        };
      }
    }
  }
  const only = both[0];
  const word = only === undefined ? undefined : usableWords(sets[0] as Set<string>)[0];
  if (only !== undefined && word !== undefined) {
    return {
      kind: 'one story',
      typed: `## Less of\n- ${word}`,
      stored: writeProfile({ more: [], less: [word], formats: [] }),
      hidden: only,
      raised: null,
    };
  }
  return {
    kind: 'no story',
    typed: '## More of\n- cricket',
    stored: writeProfile({ more: ['cricket'], less: [], formats: [] }),
    hidden: null,
    raised: null,
  };
}

test('a reader saves a profile and For You follows it, opens on it, remembers the board and talks to the reader agent', async ({
  browser,
  browserName,
  baseURL,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  test.skip(
    environment() === 'staging',
    "Staging's reader writes go through a preview: the done-test runs from the Mac",
  );
  test.setTimeout(240_000);
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no account can sign in");
  const engine = browserName as Engine;
  const base = baseURL ?? 'http://localhost:3000';

  // The run's own reader: a fresh account (a random part too), signed in without an email.
  const email = runAddress(`reader-${randomUUID().slice(0, 4)}`, engine);
  const session = await sessionFor(keys, email, { create: true });
  const signedOut = JSON.parse(await readFile(signedOutState(engine), 'utf8')) as {
    cookies: BrowserCookie[];
  };
  const reader = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: {
      cookies: [
        ...signedOut.cookies,
        ...session.cookies.map(({ name, value }) => asBrowserCookie(base, name, value)),
      ],
      origins: [],
    },
  });
  const stranger = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: signedOutState(engine),
  });
  try {
    const as = reader.request;
    const page = await reader.newPage();

    // ---- 1. The board, before a profile ----
    const first = await page.goto(BOARD);
    expect(first?.status(), 'the board').toBe(200);
    expect(new URL(page.url()).pathname, 'no profile: the board stays the board').toBe(BOARD);
    const tabs = page.getByTestId('board-tabs');
    await expect(tabs).toBeVisible();
    await expect(tabs.locator('[aria-current="true"]')).toHaveText('Board');
    await expect(tabs.getByRole('button', { name: 'For You' })).toBeVisible();
    const start = await stateOf(as);
    expect(start.holdsSomething, 'a new reader holds nothing').toBe(false);
    expect(start.usage.messagesLeftToday, 'all of the day’s messages are left').toBe(
      start.usage.dailyMessages,
    );

    // Signed out: the board's tab is one line with a link to sign in, and both pages say the same.
    const outside = await stranger.newPage();
    for (const path of [BOARD, READER, FOR_YOU]) {
      const opened = await outside.goto(path);
      expect(opened?.status(), path).toBe(200);
      const link = outside.getByRole('link', { name: /^Sign in to / });
      await expect(link, `${path}: the way to sign in`).toBeVisible();
      expect(await link.getAttribute('href')).toBe(`/sign-in-test?next=${READER}`);
    }
    await outside.close();

    // ---- 2. A profile that doesn't read ----
    await page.goto(READER);
    await expect(page.getByTestId('reader-today')).toContainText(
      `${start.usage.dailyMessages} of ${start.usage.dailyMessages} messages left today`,
    );
    await expect(page.getByTestId('reader-allowance')).toContainText('neurons used');
    await hydrated(page, '#reader-profile');
    await page.locator('#reader-profile').fill('just text');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('reader-profile-issues')).toContainText(
      /Line 1: each line is a heading or an item starting with "- "/,
    );
    expect((await stateOf(as)).holdsSomething, 'nothing was saved').toBe(false);

    // ---- 3. A good profile, from the board's own stories ----
    const board = await call(as, 'GET', '/api/v1/social/board?limit=20');
    expect(board.status, 'the board').toBe(200);
    const boardStories = (board.body as { stories: Tile[] }).stories;
    const before = await forYouOf(as);
    const pick = pickProfile(boardStories, before.tiles);
    await hydrated(page, '#reader-profile');
    await page.locator('#reader-profile').fill(pick.typed);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('reader-profile-answer')).toHaveText('Saved');
    // The form now holds the profile in its one stored form, as the API does.
    await expect(page.locator('#reader-profile')).toHaveValue(pick.stored);
    const saved = await stateOf(as);
    expect(saved.holdsSomething).toBe(true);
    expect(saved.profile).toBe(pick.stored);

    // ---- 4. Opening on For You ----
    // A browser opening the board is answered a 307 to For You, and lands there: the hop is read from the browser's own
    // navigation, which is what a reader's browser got (the design's assumption: no streaming has started yet).
    const landed = await page.goto(BOARD);
    const hop = await landed?.request().redirectedFrom()?.response();
    expect(hop?.status(), 'the board redirects a reader whose profile holds something').toBe(307);
    expect(new URL(hop?.headers().location ?? '', base).pathname).toBe(FOR_YOU);
    await expect(page).toHaveURL(new RegExp(`${FOR_YOU}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'For You' })).toBeVisible();
    await expect(page.getByTestId('for-you-built')).toHaveText('Built from your reading profile');
    const after = await forYouOf(as);
    if (pick.hidden !== null) {
      expect(after.ids, 'the story the profile hides is gone from every page').not.toContain(
        pick.hidden.id,
      );
      expect(before.ids, 'it was there before').toContain(pick.hidden.id);
      expect(after.ids, 'For You changed with the profile').not.toEqual(before.ids);
    }
    if (pick.raised !== null) {
      expect(after.ids, 'the other story is there').toContain(pick.raised.id);
    }
    // The page shows the first twenty of it.
    if (after.ids.length === 0) {
      await expect(page.getByTestId('for-you-empty')).toBeVisible();
    } else {
      // A story is told by its tile's own link, never by its title (two stories may share words).
      const list = page.getByTestId('story-list');
      const tileOf = (id: string) => list.locator(`a[href="/sandbox/social/stories/${id}"]`);
      await expect(list.getByTestId('story-tile').first()).toBeVisible();
      if (pick.hidden !== null) await expect(tileOf(pick.hidden.id)).toHaveCount(0);
      const raised = pick.raised;
      if (raised !== null && after.ids.indexOf(raised.id) < 20) {
        await expect(tileOf(raised.id).first()).toBeVisible();
      }
    }

    // ---- 5. The remembered choice ----
    const choice = async () =>
      (await reader.cookies()).find((cookie) => cookie.name === 'hz-social-tab');
    expect(await choice(), 'nothing is remembered yet').toBeUndefined();
    await page
      .getByTestId('board-tabs')
      .getByRole('button', { name: 'Board', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${BOARD}$`));
    await expect(page.getByTestId('board-tabs')).toBeVisible();
    const remembered = await choice();
    expect(remembered?.value).toBe('board');
    // A session cookie for the social sandbox only, which only our server reads.
    expect(remembered).toMatchObject({ path: BOARD, httpOnly: true, sameSite: 'Lax', expires: -1 });
    await page.getByTestId('board-order').getByRole('link', { name: 'Latest' }).click();
    await expect(page).toHaveURL(/[?&]sort=latest(&|$)/);
    await expect(page.getByTestId('board-tabs')).toBeVisible();
    await page.getByTestId('board-order').getByRole('link', { name: 'Top' }).click();
    await expect(page).toHaveURL(new RegExp(`${BOARD}$`));
    await expect(page.getByTestId('board-tabs')).toBeVisible();
    await page.getByTestId('board-tabs').getByRole('button', { name: 'For You' }).click();
    await expect(page).toHaveURL(new RegExp(`${FOR_YOU}$`));
    // The cookie is really gone, not just changed: the board opens on For You again.
    expect(await choice(), 'For You forgets the choice').toBeUndefined();
    await page.goto(BOARD);
    await expect(page).toHaveURL(new RegExp(`${FOR_YOU}$`));

    // ---- 6. The cursor ----
    const one = await call(as, 'GET', '/api/v1/reader/for-you?limit=1');
    expect(one.status).toBe(200);
    const next = (one.body as { next: string | null }).next;
    if (next !== null) {
      const second = await call(
        as,
        'GET',
        `/api/v1/reader/for-you?limit=1&cursor=${encodeURIComponent(next)}`,
      );
      expect(second.status, 'the next page').toBe(200);
      // A cursor of another build: the rebuilt sentence, on `cursor`.
      const own = decodeCursor('forYou', next);
      const flipped = own.b.startsWith('0') ? `1${own.b.slice(1)}` : `0${own.b.slice(1)}`;
      const edited = encodeCursor('forYou', { b: flipped, o: own.o });
      const refused = await call(
        as,
        'GET',
        `/api/v1/reader/for-you?limit=1&cursor=${encodeURIComponent(edited)}`,
      );
      expect(refused.status, 'a cursor of another build').toBe(400);
      expect(refused.body).toMatchObject({
        message: REBUILT,
        data: { issues: [{ path: 'cursor', message: REBUILT }] },
      });
    }

    // ---- 7. One chat message (Chromium only, and only on a first try: a check run makes at most one call to the AI) ----
    await page.goto(READER);
    let outcome = 'not sent (this engine sends none)';
    if (browserName === 'chromium') {
      const beforeChat = await stateOf(as);
      const send = page.getByRole('button', { name: 'Send', exact: true });
      const today = page.getByTestId('reader-today');
      const paused = beforeChat.usage.pausedUntil !== null;
      const used = beforeChat.usage.messagesLeftToday === 0;
      if (test.info().retry > 0) {
        // A retry is a new account, and the first try may already have sent its message: no second call to the AI.
        // (A test that passes only on its retry fails the check anyway, so nothing is lost.)
        outcome = 'not sent (a retry: the first try may have sent its message)';
        test.info().annotations.push({
          type: 'chat',
          description: 'not sent: this is a retry, and a retry never sends a second message',
        });
      } else if (paused || used) {
        // Chat is paused (Hrizzup's day is spent, or Workers AI said its allocation is) or the reader's messages are used:
        // the page says so and Send is disabled. Nothing is sent, and the rest of the journey carries on.
        outcome = paused ? 'paused before sending' : 'the day’s messages used before sending';
        test.info().annotations.push({ type: 'chat', description: outcome });
        await expect(today).toContainText(
          paused ? 'Chat pauses until 05:30 IST' : "You've used today's messages",
        );
        await expect(send).toBeDisabled();
      } else {
        await hydrated(page, '#reader-message');
        await page.locator('#reader-message').fill('More cricket, no crypto');
        await send.click();
        const said = page.getByTestId('reader-chat-answer');
        await expect(said).toBeVisible({ timeout: 90_000 });
        const afterChat = await stateOf(as);
        const sameDay = beforeChat.usage.resetsAt === afterChat.usage.resetsAt;
        const worked = (await said.getAttribute('data-ok')) === 'true';
        const words = ((await said.textContent()) ?? '').toLowerCase();
        if (worked) {
          outcome = '201, answered';
          // 201: the reply is in the chat, its neurons are decimal text, and the count went down by one.
          const messages = page.getByTestId('reader-message');
          await expect(messages).toHaveCount(2);
          await expect(messages.first()).toHaveAttribute('data-author', 'agent');
          await expect(messages.last()).toHaveAttribute('data-author', 'reader');
          const neurons = /used (\d+(?:\.\d+)?) neurons/.exec(
            (await messages.first().textContent()) ?? '',
          );
          expect(neurons, 'the reply says its neurons as decimal text').not.toBeNull();
          expect(afterChat.profile, 'a reply leaves a profile that still reads').toContain(
            '# Reading profile',
          );
          if (sameDay) {
            expect(afterChat.usage.messagesLeftToday).toBe(beforeChat.usage.messagesLeftToday - 1);
            expect(millionths(afterChat.allowance.neuronsUsed)).toBeGreaterThanOrEqual(
              millionths(beforeChat.allowance.neuronsUsed),
            );
          }
        } else if (words.includes('allowance') || words.includes('pauses until')) {
          outcome = '429, chat paused for the day';
          // 429: Hrizzup's day was spent just now: the page says chat pauses, and nothing was used.
          await expect(today).toContainText('Chat pauses until 05:30 IST');
        } else if (/busy|isn't available|took too long/.test(words)) {
          outcome = '503, the agent could not answer';
          // 503: nothing was answered; a released call gives its slot back, a kept one doesn't.
          if (sameDay) {
            expect(afterChat.usage.messagesLeftToday).toBeGreaterThanOrEqual(
              beforeChat.usage.messagesLeftToday - 1,
            );
            expect(afterChat.usage.messagesLeftToday).toBeLessThanOrEqual(
              beforeChat.usage.messagesLeftToday,
            );
          }
        } else {
          throw new Error('The reader agent answered with something this journey does not know');
        }
      }
    }
    // One line, nothing of the reader's: which way each branch went.
    console.log(`Reader journey, ${browserName}: profile from ${pick.kind}; chat: ${outcome}`);

    // ---- 8. Both signed-in pages fit ----
    await page.goto(FOR_YOU);
    await expect(page.getByRole('heading', { level: 1, name: 'For You' })).toBeVisible();
    await fitsEverywhere(page, 'For You, signed in');
    await page.goto(READER);
    await expect(page.locator('#reader-profile')).toBeVisible();
    await fitsWithoutText(page, 'the reader agent page, with its profile and chat');
  } finally {
    await reader.close();
    await stranger.close();
  }
});
