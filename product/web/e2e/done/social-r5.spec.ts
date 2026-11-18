import { categoryNames, placeNames, tiers } from '@hrizzup/social/lists';
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { call } from '../support/quiet-request.ts';
import { runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';

/**
 * The done-test of Round 6's R5 (social's board, stories and console; docs/social/build.md, sections 7.9 to 7.11):
 * the founder's Review 1, R5's half, in a real browser through the pages, on staging itself. Run by hand, once,
 * from this Mac, never by the checks (about two minutes), once M4 is on staging:
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/social-r5.spec.ts'
 * The path, as the console's admin test account (signed in through staging's admin access: no email is sent),
 * then as a reader who is signed out:
 * 1. `/console/social/invites`: an unlisted invite to an address of the run's own, at `journey.test`; the ready
 *    message shows with the code, the email and staging's `/skill.md`, and "Copy the message" says what happened;
 * 2. `/console/social/stories`: a listed test story ("R5 done-test" and the run's key) with a main category and a
 *    main place, and two updates with an https source each, added on its own console page;
 * 3. `/sandbox/social`: the story shows as a tile with its title under Top and under Latest, under its category,
 *    under its place and under its place's tier, and not under another category or another place;
 * 4. its sandbox page, opened from the board's tile: the title, both updates newest first (and "This page, oldest
 *    first" reverses them), the desk's plain empty line, and the brief with the title and both headlines;
 * 5. back in the console, "Withdraw this story…" with a reason: the board's Latest no longer shows it, and its
 *    sandbox page shows the withdrawn line with the reason;
 * 6. the run's invite is revoked through its row on the invites page.
 * Last, `GET /api/v1/social/board?sort=latest` with no key must not hold the run's story.
 * The story is listed, so it is on staging's real board from step 2 to step 5: whatever step a failed run stops
 * at, the clean-up withdraws it and revokes the invite through the same pages (best effort, soft-asserted).
 *
 * Nothing secret or other than the run's own is printed: an invite's code and message, and everything a page of
 * the board or the invites list shows, are only ever checked as shapes or presences (booleans), never put in a
 * message; every wait that could print a page's text is a boolean poll (`holds`); the one API request goes through
 * support/quiet-request.ts. Staging purges a story's and the board's public reads at once when the console saves
 * (docs/social/build.md, D6), and the sandbox's pages read in process, so each read below is the first of its kind
 * after the write it must show, with no retry of a read: a read that doesn't show it is the failure.
 */

const BASE = process.env.BASE_URL ?? '';

/** Staging's address, which every ready message names. */
const SKILL = 'https://staging.hrizzup.com/skill.md';
const CODE = /^hz-[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/;
const COPY_SAYS = /^(Copied\.|Copy failed: )/;

/** The story's main category and place, a category and a place of the lists, and others it must not show under. */
const CATEGORY = 'general';
const OTHER_CATEGORY = 'ai';
const PLACE = 'mumbai';
const TIER = 'local';
const OTHER_PLACE = 'delhi-ncr';

/** How many pages of the board are read for a story before it counts as absent: more than a run's staging holds. */
const BOARD_PAGES = 5;
const WAIT = 20_000;

const CATEGORIES = categoryNames();
const PLACES = placeNames();
const nameOf = (names: Record<string, string>, code: string): string => {
  const name = names[code];
  if (!name) throw new Error(`The agreement's lists have no ${code}`);
  return name;
};
const TIER_NAME = tiers.find((tier) => tier.code === TIER)?.name ?? '';

/** Polls a check until it holds or the time is up; a check that throws (a page still changing) just hasn't held yet. */
async function holds(check: () => Promise<boolean>, timeout = WAIT): Promise<boolean> {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      if (await check()) return true;
    } catch {
      // Not yet: the page was changing under it.
    }
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Whether a locator's first element shows, within the wait. */
const shows = (locator: Locator, timeout = WAIT) =>
  holds(() => locator.first().isVisible(), timeout);

/** The text a locator holds now, or nothing. */
const textOf = async (locator: Locator): Promise<string> =>
  (await locator.first().textContent({ timeout: 2_000 }))?.trim() ?? '';

/** Opens a page by its path, and answers its status. A failure says only what didn't open. */
async function visit(page: Page, path: string, what: string): Promise<number> {
  try {
    const answer = await page.goto(`${BASE}${path}`);
    return answer?.status() ?? 0;
  } catch {
    throw new Error(`${what} did not open`);
  }
}

async function newPage(
  browser: Browser,
  signedAs: string | null,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(signedAs ? { storageState: signedAs } : {});
  context.setDefaultTimeout(30_000);
  return { page: await context.newPage(), close: () => context.close() };
}

// ---------------------------------------------------------------------------------------------
// The console's pages
// ---------------------------------------------------------------------------------------------

/** One row of the invites list, by the run's own email. */
const inviteRow = (page: Page, email: string) =>
  page.getByTestId('invite-row').filter({ hasText: email });

/** Revokes the run's invite through its row on the invites page. True when the row then says revoked. */
async function revokeInvite(page: Page, email: string, reason: string): Promise<boolean> {
  await visit(page, '/console/social/invites', 'The invites page');
  const row = inviteRow(page, email);
  if (!(await shows(row.getByTestId('invite-state')))) return false;
  if ((await textOf(row.getByTestId('invite-state'))) === 'revoked') return true;
  await row.getByText('Revoke…').click();
  await row.getByLabel('Why').fill(reason);
  await row.getByRole('button', { name: 'Revoke this invite', exact: true }).click();
  return holds(async () => (await textOf(row.getByTestId('invite-state'))) === 'revoked');
}

/** Withdraws a story through its console page, with a reason. True when the page then says it was withdrawn. */
async function withdrawStory(page: Page, id: string, reason: string): Promise<boolean> {
  await visit(page, `/console/social/stories/${id}`, "The story's console page");
  const withdrawn = page.getByRole('heading', { level: 1, name: 'This story was withdrawn' });
  if (await shows(withdrawn, 2_000)) return true;
  await page.getByText('Withdraw this story…').click();
  await page.getByLabel('Why').fill(reason);
  await page.getByRole('button', { name: 'Withdraw this story', exact: true }).click();
  return shows(withdrawn);
}

// ---------------------------------------------------------------------------------------------
// The sandbox's board
// ---------------------------------------------------------------------------------------------

type View = { latest?: boolean; category?: string; place?: string };

/** Clicks one choice of a row of the board's links (its order, category or place), and waits until it is the one shown. */
async function choose(page: Page, row: string, name: string): Promise<void> {
  const link = page.getByTestId(row).getByRole('link', { name, exact: true });
  await link.click();
  const chosen = await holds(
    async () => (await link.getAttribute('aria-current', { timeout: 1_000 })) === 'true',
  );
  if (!chosen) throw new Error(`The board's ${row} did not switch`);
}

/** Opens the board and picks its order, category and place the way a reader does: by the links on the page. */
async function openBoard(page: Page, view: View): Promise<void> {
  expect(await visit(page, '/sandbox/social', 'The board'), 'the board answers').toBe(200);
  if (view.latest) await choose(page, 'board-order', 'Latest');
  if (view.category) await choose(page, 'board-category', view.category);
  if (view.place) await choose(page, 'board-place', view.place);
}

/**
 * Whether the board in its view holds the run's story, looking through its first pages by the "Next" link.
 * It answers a boolean and never what the board holds: the board is staging's, full of other stories.
 */
async function boardHolds(page: Page, title: string): Promise<boolean> {
  for (let at = 0; at < BOARD_PAGES; at++) {
    const drawn = page.getByTestId('story-list').or(page.getByTestId('board-empty'));
    if (!(await shows(drawn))) throw new Error('The board did not draw');
    if ((await page.getByTestId('story-tile').filter({ hasText: title }).count()) > 0) return true;
    const next = page.getByRole('link', { name: 'Next', exact: true });
    if ((await next.count()) === 0) return false;
    const before = page.url();
    await next.click();
    if (!(await holds(async () => page.url() !== before))) {
      throw new Error("The board's next page did not open");
    }
  }
  return false;
}

/** The headlines of a story page's updates, in the order shown. */
const headlinesShown = (page: Page) =>
  page.getByTestId('story-update').getByRole('heading', { level: 3 }).allTextContents();

test("R5's done-test: the founder's Review 1 path (invite, story, board, story page, withdraw, revoke), through the pages on staging", async ({
  playwright,
  browser,
}) => {
  test.setTimeout(300_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const key = runKey();
  const email = `r5-done-${key}@journey.test`;
  const title = `R5 done-test ${key}`;
  const first = `${title}: the first update`;
  const second = `${title}: the second update`;
  const reason = `R5's done-test is over (${key})`;
  // What was made, so the clean-up knows what is left whatever step the run stopped at.
  const made = { invite: false, revoked: false, storyId: null as string | null, withdrawn: false };

  // The console's admin test account, and a reader who is signed out, each in a browser of their own.
  const admin = await newPage(browser, adminState('chromium'));
  const reader = await newPage(browser, null);
  const anyone = await playwright.request.newContext({ baseURL: BASE });
  // The clipboard needs a permission in a headless browser; granted when Playwright allows it.
  let clipboard = true;
  try {
    await admin.page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  } catch {
    clipboard = false;
  }

  try {
    // 1. An unlisted invite, for an address of the run's own, and its ready message.
    expect(await visit(admin.page, '/console/social/invites', 'The invites page')).toBe(200);
    expect(
      await shows(admin.page.getByRole('heading', { level: 1, name: 'Invites' })),
      'the invites page shows its heading',
    ).toBe(true);
    await admin.page.getByLabel('Email').fill(email);
    await admin.page.getByLabel('Note (optional)').fill(`R5's done-test (${key})`);
    await admin.page.getByRole('radio', { name: /^Unlisted/ }).check();
    await admin.page.getByRole('button', { name: 'Make the invite' }).click();
    made.invite = true;
    const invite = admin.page.getByTestId('invite-made');
    expect(await shows(invite), 'the invite is made, and its ready message shows').toBe(true);
    const message = await invite.getByTestId('invite-message').inputValue();
    const code = await textOf(invite.getByTestId('invite-code'));
    // Booleans, so a failure prints no code and no address.
    expect(CODE.test(code), 'the code has the shape of an invite code').toBe(true);
    expect(message.includes(code), 'the message holds the code').toBe(true);
    expect(message.includes(email), 'the message holds the email').toBe(true);
    expect(message.includes(SKILL), "the message names staging's skill.md").toBe(true);

    // "Copy the message" says what happened: Copied once the browser may use the clipboard, else either.
    await admin.page.bringToFront();
    await invite.getByRole('button', { name: 'Copy the message' }).click();
    const copyStatus = invite.getByTestId('copy-status');
    expect(
      await holds(async () => COPY_SAYS.test(await textOf(copyStatus))),
      'the page says Copied or Copy failed',
    ).toBe(true);
    if (clipboard) {
      expect((await textOf(copyStatus)) === 'Copied.', 'the clipboard took the message').toBe(true);
      const copied = await admin.page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => null);
      if (copied !== null) expect(copied === message, 'the clipboard holds the message').toBe(true);
    }

    // 2. A listed test story, then its two updates, added on its own console page.
    expect(await visit(admin.page, '/console/social/stories', 'The stories page')).toBe(200);
    expect(
      await shows(admin.page.getByRole('heading', { level: 1, name: 'Stories' })),
      'the stories page shows its heading',
    ).toBe(true);
    await admin.page.getByLabel('Title').fill(title);
    await admin.page
      .getByLabel('Summary')
      .fill(
        `A test story of R5's done-test (${key}), made through the console's pages on staging.`,
      );
    await admin.page.getByLabel('Main category').selectOption(CATEGORY);
    await admin.page.getByLabel('Main place').selectOption(PLACE);
    await admin.page.getByRole('radio', { name: /^Listed/ }).check();
    await admin.page.getByRole('button', { name: 'Save the story' }).click();
    const opened = await holds(async () =>
      /\/console\/social\/stories\/[0-9a-f-]{36}$/.test(admin.page.url()),
    );
    expect(opened, "saving the story opens the story's own console page").toBe(true);
    const storyId = admin.page.url().split('/').pop() ?? '';
    made.storyId = storyId;
    expect(
      await shows(admin.page.getByRole('heading', { level: 1, name: title })),
      "the story's console page shows its title",
    ).toBe(true);
    expect(
      (await textOf(admin.page.getByTestId('story-facts'))).includes('listed on the board'),
      'the story is listed on the board',
    ).toBe(true);

    const headline = admin.page.getByLabel('Headline');
    const updates = admin.page.getByTestId('console-update');
    for (const [at, text] of [first, second].entries()) {
      await headline.fill(text);
      await admin.page
        .getByLabel('Sources')
        .fill(`https://example.com/sources/social-r5-done-test-${at + 1}`);
      await admin.page.getByRole('button', { name: 'Add the update' }).click();
      // The form is clear for the next update only once the save is over.
      const saved = await holds(
        async () => (await updates.count()) === at + 1 && (await headline.inputValue()) === '',
      );
      expect(
        saved,
        `update ${at + 1} is saved, shows on the console page and clears the form`,
      ).toBe(true);
    }

    // 3. The board, as a reader: under Top, Latest, its category, its place and its place's tier; not under
    // another category or another place.
    const mark = (what: string, found: boolean) =>
      expect(found, `the story shows on the board: ${what}`).toBe(true);
    await openBoard(reader.page, {});
    mark('under Top (in its first pages)', await boardHolds(reader.page, title));
    await openBoard(reader.page, { latest: true });
    mark('under Latest', await boardHolds(reader.page, title));
    await openBoard(reader.page, { category: nameOf(CATEGORIES, CATEGORY) });
    mark("under its category (General), Top's order", await boardHolds(reader.page, title));
    await openBoard(reader.page, { place: nameOf(PLACES, PLACE) });
    mark('under its place (Mumbai)', await boardHolds(reader.page, title));
    await openBoard(reader.page, { place: TIER_NAME });
    mark("under its place's tier (Local)", await boardHolds(reader.page, title));
    // Latest puts a story that was just updated first, so a filter that wrongly kept it would show it at once.
    await openBoard(reader.page, { latest: true, category: nameOf(CATEGORIES, OTHER_CATEGORY) });
    expect(
      await boardHolds(reader.page, title),
      'the story shows on the board under another category (AI)',
    ).toBe(false);
    await openBoard(reader.page, { latest: true, place: nameOf(PLACES, OTHER_PLACE) });
    expect(
      await boardHolds(reader.page, title),
      'the story shows on the board under another place (Delhi NCR)',
    ).toBe(false);

    // 4. Its sandbox page, opened from its tile on the board's Latest.
    await openBoard(reader.page, { latest: true });
    expect(await boardHolds(reader.page, title), 'the story is on Latest to open from').toBe(true);
    const tile = reader.page.getByTestId('story-tile').filter({ hasText: title });
    await tile.getByRole('link', { name: title, exact: true }).click();
    const onItsPage = await holds(async () =>
      reader.page.url().endsWith(`/sandbox/social/stories/${storyId}`),
    );
    expect(onItsPage, "the tile's link opens the story's sandbox page").toBe(true);
    expect(
      await shows(reader.page.getByRole('heading', { level: 1, name: title })),
      "the story's page shows its title",
    ).toBe(true);
    expect(
      await holds(async () => (await headlinesShown(reader.page)).length === 2),
      'the story page shows both updates',
    ).toBe(true);
    expect(await headlinesShown(reader.page), 'the updates, newest first').toEqual([second, first]);
    await choose(reader.page, 'story-order', 'This page, oldest first');
    expect(await headlinesShown(reader.page), 'the updates, this page oldest first').toEqual([
      first,
      second,
    ]);
    expect(await textOf(reader.page.getByTestId('desk-empty')), "the desk's plain empty line").toBe(
      'No posts yet.',
    );
    const brief = await textOf(reader.page.getByTestId('story-brief'));
    expect(brief.includes(title), 'the brief holds the title').toBe(true);
    expect(brief.includes(first), 'the brief holds the first headline').toBe(true);
    expect(brief.includes(second), 'the brief holds the second headline').toBe(true);

    // 5. Withdrawn in the console, with a reason: off the board, and its page says why.
    expect(
      await withdrawStory(admin.page, storyId, reason),
      'withdrawing the story, its console page says it was withdrawn',
    ).toBe(true);
    made.withdrawn = true;
    expect(
      (await textOf(admin.page.getByTestId('story-withdrawn'))).includes(reason),
      'the console page gives the reason',
    ).toBe(true);
    await openBoard(reader.page, { latest: true });
    expect(
      await boardHolds(reader.page, title),
      'the withdrawn story still shows on the board (Latest)',
    ).toBe(false);
    expect(
      await visit(reader.page, `/sandbox/social/stories/${storyId}`, "The story's sandbox page"),
      'the withdrawn story answers',
    ).toBe(200);
    expect(
      await shows(reader.page.getByRole('heading', { level: 1, name: 'This story was withdrawn' })),
      'the sandbox page says the story was withdrawn',
    ).toBe(true);
    expect(
      (await textOf(reader.page.getByTestId('story-withdrawn'))).includes(reason),
      'the sandbox page gives the reason',
    ).toBe(true);

    // 6. The run's invite is revoked through its row.
    expect(await revokeInvite(admin.page, email, reason), 'the invite is revoked').toBe(true);
    made.revoked = true;

    // Last, the public API's board (no key): its newest page doesn't hold the run's story.
    const board = await call(anyone, 'GET', '/api/v1/social/board?sort=latest');
    expect(board.status, 'the public board answers').toBe(200);
    const stories = (board.body.stories ?? []) as { id: string; title: string }[];
    expect(Array.isArray(board.body.stories), 'the public board lists stories').toBe(true);
    expect(
      stories.some((story) => story.id === storyId || story.title === title),
      "the public board's Latest holds the run's story",
    ).toBe(false);
  } finally {
    // Whatever step a failed run stopped at, nothing of it stays live: the story is withdrawn and the invite
    // revoked, through the same pages. Best effort: it never throws, so it can't hide the failure that came first.
    const tidy = async (done: () => Promise<boolean>) => done().catch(() => false);
    if (made.storyId !== null && !made.withdrawn) {
      const id = made.storyId;
      expect
        .soft(
          await tidy(() => withdrawStory(admin.page, id, reason)),
          'the clean-up withdrew the story',
        )
        .toBe(true);
    }
    if (made.invite && !made.revoked) {
      expect
        .soft(
          await tidy(() => revokeInvite(admin.page, email, reason)),
          'the clean-up revoked the invite',
        )
        .toBe(true);
    }
    await Promise.all(
      [admin.close(), reader.close(), anyone.dispose()].map((closing) =>
        closing.catch(() => undefined),
      ),
    );
  }
});
