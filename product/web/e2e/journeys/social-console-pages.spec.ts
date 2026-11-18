import { type Browser, expect, type Page, test } from '@playwright/test';
import { layoutProblems } from '../layout.ts';
import { consoleSocialPages } from '../pages/social/console.ts';
import { runKey } from '../support/run.ts';
import { adminState, signedInState } from '../support/states.ts';
import { phone } from './phone.ts';

/**
 * Journey: the console's social pages (docs/social/build.md, section 7.10; R5's M4), at a phone size, in
 * Chromium and WebKit, driven through the pages as the founder would.
 * - Anyone but an admin, signed in or not, gets "not found" for every page of it: the site's own page, 404.
 * - An admin makes an unlisted invite through the page, reads the ready message (it holds the code, the email and
 *   staging's `/skill.md`), copies it (or is told in a line that the browser refused), is told a second invite for
 *   the same email is refused with that invite's revoke control beside, and revokes the first through its row.
 * - An admin makes an unlisted test story with a category and a place, adds two updates (the second corrects the
 *   first), follows the link to the story's page in the sandbox and sees both, then withdraws it with a reason,
 *   which its pages in the console and the sandbox then give.
 * - The settings and agents pages open and show their forms. Nothing is saved there: the settings are shared by
 *   every environment on staging's database, and the agents are real people's.
 * Each run's records carry its key and are unlisted, so nothing reaches the board. Where a check could print what a
 * page shows (an invite's code, an email), it compares as a boolean first, so a failure names no secret and no
 * address. No screenshot is taken and no layout check prints text of a list that holds real people.
 */
test.use(phone);

const onProduction = () => process.env.SCREEN_CHECK_ENVIRONMENT === 'production';

/** Staging's address, which every ready message names, whichever environment made the invite (it uses staging's database). */
const SKILL = 'https://staging.hrizzup.com/skill.md';
const CODE = /^hz-[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/;

async function asAdmin(browser: Browser, browserName: string): Promise<Page> {
  const context = await browser.newContext({ ...phone, storageState: adminState(browserName) });
  return context.newPage();
}

test('anyone but an admin, signed in or not, finds none of the social console', async ({
  page,
  browser,
  browserName,
}) => {
  const paths = consoleSocialPages.map((entry) => entry.path);
  expect(paths.length).toBeGreaterThanOrEqual(6);
  for (const path of paths) {
    const visitor = await page.goto(path);
    expect(visitor?.status(), `${path}, signed out`).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
  test.skip(onProduction(), 'No test accounts on production');
  const context = await browser.newContext({ ...phone, storageState: signedInState(browserName) });
  const member = await context.newPage();
  for (const path of paths) {
    const answer = await member.goto(path);
    expect(answer?.status(), `${path}, signed in but not an admin`).toBe(404);
    await expect(member.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  }
  await context.close();
});

test('an admin makes an invite, copies its ready message and revokes it', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  // A retry of this test (the Screen check retries once in GitHub) gets a name of its own: the first try may have made the invite.
  const attempt = test.info().retry ? `-retry${test.info().retry}` : '';
  const email = `social-console-${runKey()}-${browserName}${attempt}@journey.test`;

  await page.goto('/console');
  await page.getByRole('link', { name: 'Social console' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Social console' })).toBeVisible();
  await page.getByRole('link', { name: 'Invites', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Invites' })).toBeVisible();

  // The choice of listed has no default: nothing of it is chosen until it is chosen.
  await expect(page.getByRole('radio', { name: /^Listed/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /^Unlisted/ })).not.toBeChecked();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Note (optional)').fill('A test invite of the console journey');
  await page.getByRole('radio', { name: /^Unlisted/ }).check();
  await page.getByRole('button', { name: 'Make the invite' }).click();

  const made = page.getByTestId('invite-made');
  await expect(made).toBeVisible();
  const message = await made.getByTestId('invite-message').inputValue();
  const code = (await made.getByTestId('invite-code').textContent())?.trim() ?? '';
  // Booleans, so a failure prints no code and no address.
  expect(CODE.test(code), 'the code has the shape of an invite code').toBe(true);
  expect(message.includes(code), 'the message holds the code').toBe(true);
  expect(message.includes(email), 'the message holds the email').toBe(true);
  expect(message.includes(SKILL), "the message names staging's skill.md").toBe(true);
  await expect(made.getByTestId('invite-message')).toHaveAttribute('readonly', '');

  // The copy button says what happened: a browser may refuse the clipboard (WebKit, or a page it
  // doesn't trust), and the message is on the page to be selected by hand.
  await made.getByRole('button', { name: 'Copy the message' }).click();
  await expect(made.getByTestId('copy-status')).toHaveText(/^(Copied\.|Copy failed: )/);

  // The list holds the new invite, open, unlisted, with its note.
  const row = page.getByTestId('invite-row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('invite-state')).toHaveText('open');
  await expect(row).toContainText('unlisted');
  await expect(row).toContainText('A test invite of the console journey');

  // The page fits with a row's form open and the made invite's block shown (the email field is clear for the next
  // invite). Only how many problems are asserted: the list holds other people's emails, which a problem's description
  // would print.
  await row.getByText('Revoke…').click();
  expect((await layoutProblems(page)).length, 'layout problems on the invites page').toBe(0);

  // A second invite for the same email is refused in a plain line, with the open invite's own revoke control.
  await page.getByLabel('Email').fill(email);
  await page.getByRole('radio', { name: /^Unlisted/ }).check();
  await page.getByRole('button', { name: 'Make the invite' }).click();
  const clash = page.getByTestId('invite-clash');
  await expect(clash).toContainText('This email already has an open invite: revoke it first');
  await expect(clash.getByLabel('Why')).toBeVisible();
  await expect(page.getByTestId('invite-made')).toHaveCount(0);

  // Revoke it through its row, with a reason (required: the field says so).
  const why = row.getByLabel('Why');
  await expect(why).toHaveAttribute('required', '');
  await why.fill('The console journey is done with it');
  await row.getByRole('button', { name: 'Revoke this invite', exact: true }).click();
  await expect(row.getByTestId('invite-state')).toHaveText('revoked');
  await expect(row).toContainText('The console journey is done with it');
  await expect(row.getByText('Revoke…')).toHaveCount(0);
  await page.context().close();
});

test('an admin makes a test story, adds two updates and finds both on its sandbox page', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  // A retry of this test gets a title of its own, as the invite's email does.
  const label = `run ${runKey()}, ${browserName}${test.info().retry ? `, retry ${test.info().retry}` : ''}`;
  const title = `Journey test (${label}): a test story made in the social console`;

  await page.goto('/console/social/stories');
  await expect(page.getByRole('heading', { level: 1, name: 'Stories' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Listed/ })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: /^Unlisted/ })).not.toBeChecked();

  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel('Summary')
    .fill(`A test story of a check run (${label}), made by the console's pages. Unlisted.`);
  await page.getByLabel('Main category').selectOption('general');
  await page.getByLabel('Main place').selectOption('mumbai');
  await page.getByRole('radio', { name: /^Unlisted/ }).check();
  await page.getByRole('button', { name: 'Save the story' }).click();

  await expect(page).toHaveURL(/\/console\/social\/stories\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByTestId('story-facts')).toContainText('unlisted');
  await expect(page.getByTestId('updates-empty')).toBeVisible();
  const consoleStory = page.url();

  // The first update.
  const first = `First update (${label}): the first development`;
  await page.getByLabel('Headline').fill(first);
  await page.getByLabel('Sources').fill('https://example.com/sources/social-console-pages-first');
  await page.getByRole('button', { name: 'Add the update' }).click();
  await expect(page.getByTestId('console-saved')).toContainText('Update saved');
  await expect(page.getByTestId('console-update')).toHaveCount(1);
  // The form is clear for the next one.
  await expect(page.getByLabel('Headline')).toHaveValue('');

  // The second corrects the first (it is offered once the first is in the timeline), with a detail and two sources.
  const second = `Second update (${label}): a correction of the first`;
  await page.getByLabel('Headline').fill(second);
  await page
    .getByLabel('Detail (optional)')
    .fill('The first update was not right.\nThis puts it right.');
  await page
    .getByLabel('Sources')
    .fill(
      'https://example.com/sources/social-console-pages-second\nhttps://example.org/sources/social-console-pages-more',
    );
  await page.getByLabel('Corrects (optional)').selectOption({ label: first });
  await page.getByRole('button', { name: 'Add the update' }).click();
  await expect(page.getByTestId('console-update')).toHaveCount(2);
  await expect(page.getByTestId('console-updates')).toContainText(second);

  // Its page in the sandbox shows both, the second marked as a correction of the first.
  await page.getByTestId('sandbox-story-link').click();
  await expect(page).toHaveURL(/\/sandbox\/social\/stories\/[0-9a-f-]{36}$/);
  const updates = page.getByTestId('story-update');
  await expect(updates).toHaveCount(2);
  await expect(page.getByTestId('story-updates')).toContainText(first);
  await expect(page.getByTestId('story-updates')).toContainText(second);
  await expect(page.getByTestId('update-corrects')).toHaveCount(1);
  await expect(page.getByTestId('update-corrected')).toHaveCount(1);

  // The story is unlisted, so it is not on the board; the console lists it, unlisted, with its page.
  await page.goto('/console/social/stories');
  const row = page.getByTestId('story-row').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('unlisted');
  await row.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(consoleStory);

  // Withdrawn with a reason (how a listed test story would leave the board): its page says why, and so does the sandbox's.
  const reason = 'The console journey is done with this story';
  await page.getByText('Withdraw this story…').click();
  await page.getByLabel('Why').fill(reason);
  await page.getByRole('button', { name: 'Withdraw this story', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'This story was withdrawn' }),
  ).toBeVisible();
  await expect(page.getByTestId('story-withdrawn')).toContainText(reason);
  await page.goto(`/sandbox/social/stories/${consoleStory.split('/').pop()}`);
  await expect(page.getByTestId('story-withdrawn')).toContainText(reason);
  await page.context().close();
});

test('the settings and agents pages open and show their forms; nothing is saved there', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);

  await page.goto('/console/social/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const form = page.getByTestId('settings-form');
  await expect(form).toBeVisible();
  // Every setting is a field with its range, filled with its value now, and a reason is required.
  await expect(form.getByLabel('Posts a day', { exact: true })).toHaveValue(/^\d+$/);
  await expect(form.getByLabel('Posts a day', { exact: true })).toHaveAttribute('type', 'number');
  await expect(form.getByLabel('Reader AI: provider')).toBeVisible();
  await expect(form.getByText('A whole number, 0 to 1,000.').first()).toBeVisible();
  await expect(form.getByLabel('Why')).toHaveAttribute('required', '');
  expect(await form.locator('input[type="number"]').count()).toBeGreaterThan(15);
  await expect(page.getByRole('heading', { level: 2, name: 'The change log' })).toBeVisible();
  // An empty send is refused by the browser, not sent: the reason field stands in the way.
  await form.getByRole('button', { name: 'Change the settings' }).click();
  await expect(page.getByTestId('console-saved')).toHaveCount(0);

  await page.goto('/console/social/agents');
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  // Either some agents, each with its two forms, or none yet.
  const agents = page.getByTestId('agent-row');
  if ((await agents.count()) > 0) {
    const first = agents.first();
    await first.getByText('Change limits and mark').click();
    await first.getByText('Revoke keys').click();
    // Both forms stand open, and the page still fits (only the count is asserted: a problem's description would print
    // an agent's name).
    await expect(first.getByTestId('agent-limits-form')).toBeVisible();
    await expect(first.getByTestId('agent-keys-form')).toBeVisible();
    expect((await layoutProblems(page)).length, 'layout problems on the agents page').toBe(0);
  } else {
    await expect(page.getByTestId('agents-empty')).toBeVisible();
  }
  await page.context().close();
});

test('the two lists of people, opened where the Screen check opens them, hold no row', async ({
  browser,
  browserName,
}) => {
  test.skip(onProduction(), "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  // The Screen check's screenshots are public: these two addresses must show no email, whoever has been invited.
  const address = (name: string) => {
    const entry = consoleSocialPages.find((candidate) => candidate.name === name);
    if (!entry) throw new Error(`No page called ${name}`);
    return entry.path;
  };
  await page.goto(address('console-social-invites'));
  await expect(page.getByRole('heading', { level: 1, name: 'Invites' })).toBeVisible();
  await expect(page.getByTestId('invite-form')).toBeVisible();
  await expect(page.getByTestId('invites-empty')).toBeVisible();
  await expect(page.getByTestId('invite-row')).toHaveCount(0);
  await page.goto(address('console-social-agents'));
  await expect(page.getByRole('heading', { level: 1, name: 'Agents' })).toBeVisible();
  await expect(page.getByTestId('agents-empty')).toBeVisible();
  await expect(page.getByTestId('agent-row')).toHaveCount(0);
  await page.context().close();
});
