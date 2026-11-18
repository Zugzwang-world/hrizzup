import { encodeCursor } from '@hrizzup/social/cursor';
import { expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import {
  BOARD_FIXTURE_STORY,
  BOARD_FIXTURE_TITLE,
  BOARD_FIXTURE_UPDATES,
} from '../fixtures/social/board.ts';

/**
 * Journey: the sandbox's board and story pages (docs/social/build.md, section 7.11; R5's M5), opened in
 * a browser as a reader would, in Chromium and WebKit, on the board fixture (`fixtures/social/board.ts`: an
 * unlisted test story with three updates, one a correction, and an empty desk, which global-setup.ts keeps).
 * - The board answers; its order, category and place choices are links that each keep it answering
 *   (every address is asked for, and a click keeps the others' choices); a cursor of the right list opens a
 *   page with a way back to the first; a value that isn't one of the lists (a filter, a cursor, a name
 *   sent twice) is dropped with a plain line, and the page still answers.
 * - The fixture story's page: its title, its three updates newest first and then oldest first, the
 *   correction marked on both, its sources as links, the older page of its timeline through a cursor, the
 *   empty desk's plain line, the brief holding the title; bad values in the address are dropped the same
 *   way; a story that doesn't exist, and an address that is no story's, are 404.
 * The pages are read only: nothing here writes, so no run changes what another sees. Social doesn't exist
 * on production until launch, and staging is skipped as `social-console-saves.spec.ts` skips it (the fixture
 * is made through the console's saves, which staging's firewall allows only from a browser).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;
const STORY = `/sandbox/social/stories/${BOARD_FIXTURE_STORY}`;
const [first, second, third] = BOARD_FIXTURE_UPDATES;

test.describe('the sandbox’s board and story pages', () => {
  test.beforeEach(() => {
    test.skip(environment() === 'production', "Social doesn't exist on production until launch");
    test.skip(
      environment() === 'staging',
      'The fixture is made through writes: see console-api.spec.ts',
    );
  });

  test('the board answers, and its order, filters and paging are links that keep it answering', async ({
    page,
  }) => {
    const response = await page.goto('/sandbox/social');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
    // The fixture is unlisted: it is never on the board.
    await expect(page.getByTestId('story-list').getByText(BOARD_FIXTURE_TITLE)).toHaveCount(0);

    // Every choice is an address, and each answers (the one being shown, "All categories" and "All places" of an unfiltered board are the same address).
    const choices = page.locator(
      '[data-testid="board-order"] a, [data-testid="board-category"] a, [data-testid="board-place"] a',
    );
    const hrefs = await choices.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      const answer = await page.request.get(href);
      expect(answer.status(), href).toBe(200);
    }

    // A click keeps what was chosen before it: Latest, then a category, then a place, then back to every place.
    await page.getByTestId('board-order').getByRole('link', { name: 'Latest' }).click();
    await expect(page).toHaveURL(/[?&]sort=latest(&|$)/);
    await expect(
      page.getByTestId('board-order').getByRole('link', { name: 'Latest' }),
    ).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('board-category').getByRole('link').nth(1).click();
    await expect(page).toHaveURL(/[?&]category=[a-z]+/);
    await expect(page).toHaveURL(/[?&]sort=latest(&|$)/);
    await page.getByTestId('board-place').getByRole('link').nth(1).click();
    await expect(page).toHaveURL(/[?&]place=[a-z-]+/);
    await expect(page).toHaveURL(/[?&]category=[a-z]+/);
    await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
    await page.getByTestId('board-place').getByRole('link', { name: 'All places' }).click();
    await expect(page).not.toHaveURL(/place=/);
    await expect(page).toHaveURL(/[?&]category=[a-z]+/);
    await page.getByTestId('board-category').getByRole('link', { name: 'All categories' }).click();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page).toHaveURL(/[?&]sort=latest(&|$)/);
    await page.getByTestId('board-order').getByRole('link', { name: 'Top' }).click();
    await expect(page).toHaveURL(/\/sandbox\/social$/);
  });

  test('a cursor of the board’s own list opens a page, with a way back to the first', async ({
    page,
  }) => {
    const top = encodeCursor('top', { r: '0', i: BOARD_FIXTURE_STORY });
    const time = encodeCursor('time', { t: '2026-11-15T05:00:00.000Z', i: BOARD_FIXTURE_STORY });
    for (const address of [
      `/sandbox/social?cursor=${top}`,
      `/sandbox/social?sort=latest&cursor=${time}`,
    ]) {
      const response = await page.goto(address);
      expect(response?.status(), address).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
      // Its own list's cursor is taken, never dropped with a line.
      await expect(page.getByTestId('board-notes')).toHaveCount(0);
      await page.getByRole('link', { name: 'First page' }).click();
      await expect(page).not.toHaveURL(/cursor=/);
    }
    // Where there is a next page, it is a link that answers and leads back.
    await page.goto('/sandbox/social');
    const next = page.getByRole('link', { name: 'Next', exact: true });
    if ((await next.count()) > 0) {
      await next.click();
      await expect(page).toHaveURL(/[?&]cursor=/);
      await expect(page.getByRole('link', { name: 'First page' })).toBeVisible();
    }
  });

  test('a value that is not one of the lists is dropped with a line, and the board still answers', async ({
    page,
  }) => {
    const time = encodeCursor('time', { t: '2026-11-15T05:00:00.000Z', i: BOARD_FIXTURE_STORY });
    for (const query of [
      'cursor=not-a-cursor',
      `cursor=${time}`, // a cursor of Latest, sent to Top
      'category=nope',
      'place=nowhere',
      'sort=sideways',
      'category=ai&category=sports',
      'sort=sideways&category=nope&place=nowhere&cursor=not-a-cursor',
    ]) {
      const response = await page.goto(`/sandbox/social?${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Board' }), query).toBeVisible();
      await expect(page.getByTestId('board-notes'), query).toBeVisible();
    }
    // One bad filter leaves a good one as it was.
    await page.goto('/sandbox/social?category=general&place=nowhere');
    await expect(
      page.getByTestId('board-category').getByRole('link', { name: 'All categories' }),
    ).not.toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByTestId('board-place').getByRole('link', { name: 'All places' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  test('the story page shows its title, its updates in order with the correction marked and its sources linked, the empty desk and the brief', async ({
    page,
  }) => {
    const response = await page.goto(STORY);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: BOARD_FIXTURE_TITLE })).toBeVisible();

    // The timeline, newest first.
    const headlines = [third.headline, second.headline, first.headline];
    const updates = page.getByTestId('story-update');
    await expect(updates).toHaveCount(3);
    await expect(updates.getByRole('heading', { level: 3 })).toHaveText(headlines);
    // The third corrects the first, and both say so; the second's body is shown as written.
    await expect(updates.nth(0).getByTestId('update-corrects')).toContainText(first.headline);
    await expect(updates.nth(2).getByTestId('update-corrected')).toBeVisible();
    await expect(page.getByTestId('update-corrects')).toHaveCount(1);
    await expect(page.getByTestId('update-corrected')).toHaveCount(1);
    await expect(updates.nth(1)).toContainText('It is plain text, kept as written.');
    // Sources are links.
    for (const source of second.sources) {
      await expect(updates.nth(1).getByRole('link', { name: source })).toHaveAttribute(
        'href',
        source,
      );
    }

    // Oldest first, then back.
    await page.getByTestId('story-order').getByRole('link', { name: 'Oldest first' }).click();
    await expect(page).toHaveURL(/[?&]order=oldest/);
    await expect(page.getByTestId('story-update').getByRole('heading', { level: 3 })).toHaveText(
      [...headlines].reverse(),
    );
    await page.getByTestId('story-order').getByRole('link', { name: 'Newest first' }).click();
    await expect(page).not.toHaveURL(/order=/);

    // The older page of the timeline, through a cursor of the update after which it starts.
    const older = encodeCursor('time', { t: second.reportedAt, i: second.id });
    const olderResponse = await page.goto(`${STORY}?updates=${older}`);
    expect(olderResponse?.status()).toBe(200);
    await expect(page.getByTestId('story-notes')).toHaveCount(0);
    await expect(page.getByTestId('story-update').getByRole('heading', { level: 3 })).toHaveText([
      first.headline,
    ]);
    await page.getByRole('link', { name: 'Back to the newest updates' }).click();
    await expect(page.getByTestId('story-update')).toHaveCount(3);

    // The desk: nothing is ever posted on the fixture, so it is empty, either way it is ordered.
    await expect(page.getByTestId('desk-empty')).toHaveText('No posts yet.');
    await page.getByTestId('desk-order').getByRole('link', { name: 'Latest' }).click();
    await expect(page).toHaveURL(/[?&]desk=latest/);
    await expect(page.getByTestId('desk-empty')).toHaveText('No posts yet.');
    await expect(page.getByTestId('story-update')).toHaveCount(3);

    // The brief holds the story's title and its timeline.
    const brief = page.getByTestId('story-brief');
    await expect(brief).toContainText(BOARD_FIXTURE_TITLE);
    await expect(brief).toContainText(first.headline);
    await expect(brief).toContainText(third.headline);

    // Every order's address answers.
    const choices = page.locator('[data-testid="story-order"] a, [data-testid="desk-order"] a');
    for (const href of await choices.evaluateAll((links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    )) {
      expect((await page.request.get(href)).status(), href).toBe(200);
    }
  });

  test('a value in a story page’s address that is not one of its lists is dropped with a line, and the page still answers', async ({
    page,
  }) => {
    const topPosts = encodeCursor('top', { r: '0', i: BOARD_FIXTURE_STORY });
    for (const query of [
      'order=sideways',
      'updates=not-a-cursor',
      'desk=sideways',
      'posts=not-a-cursor',
      `desk=latest&posts=${topPosts}`, // Top's cursor on a desk ordered Latest
      'order=oldest&order=newest',
      'order=sideways&updates=not-a-cursor&desk=sideways&posts=not-a-cursor',
    ]) {
      const response = await page.goto(`${STORY}?${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(
        page.getByRole('heading', { level: 1, name: BOARD_FIXTURE_TITLE }),
        query,
      ).toBeVisible();
      await expect(page.getByTestId('story-notes'), query).toBeVisible();
      await expect(page.getByTestId('story-update'), query).toHaveCount(3);
    }
    // A desk cursor of the desk's own order is taken, never dropped with a line.
    const own = encodeCursor('id', { i: BOARD_FIXTURE_STORY });
    const response = await page.goto(`${STORY}?desk=latest&posts=${own}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByTestId('story-notes')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the first posts' })).toBeVisible();
  });

  test('a story that is not there, and an address that is no story’s, are not found', async ({
    page,
  }) => {
    for (const address of [
      `/sandbox/social/stories/${newRecordId()}`,
      '/sandbox/social/stories/not-an-id',
      `/sandbox/social/stories/${BOARD_FIXTURE_STORY}0`,
    ]) {
      const response = await page.goto(address);
      expect(response?.status(), address).toBe(404);
    }
  });
});
