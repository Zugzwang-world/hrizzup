import { expect, test } from '@playwright/test';
import { asBrowserCookie } from '../support/bypass.ts';
import {
  type Engine,
  stagingKeys,
  TEST_ACCOUNTS,
  testSessionCookies,
} from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: signing in and out, on the sign-in test page (staging, previews and this Mac; it
 * doesn't exist on production). Google can't be signed into by a test, so the test account
 * signs in the only way it can: a fresh session from staging's one-time token, set as the very
 * cookies the website sets after a real sign-in (support/test-accounts.ts). Signing out then
 * goes through the page's own button. Google sign-in itself is followed up to Google's door.
 */
test.use(phone);

const SIGNED_OUT = "You're signed out";
const SIGNED_IN = "You're signed in";

function skipOnProduction() {
  test.skip(
    process.env.SCREEN_CHECK_ENVIRONMENT === 'production',
    "The sign-in test page doesn't exist on production",
  );
}

test('the test account signs in and out', async ({ page, context, baseURL, browserName }) => {
  skipOnProduction();
  const keys = stagingKeys();
  if (!keys)
    throw new Error("Staging's Supabase keys are missing, so the test account can't sign in");
  const email = TEST_ACCOUNTS[browserName as Engine];

  await page.goto('/sign-in-test');
  await expect(page.getByRole('heading', { name: SIGNED_OUT })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  const session = await testSessionCookies(keys, email);
  await context.addCookies(
    session.map(({ name, value }) => asBrowserCookie(baseURL ?? '', name, value)),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: SIGNED_IN })).toBeVisible();
  await expect(page.getByTestId('signed-in-email')).toHaveText(email);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in-test$/);
  await expect(page.getByRole('heading', { name: SIGNED_OUT })).toBeVisible();
  const sessionCookies = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
  expect(
    sessionCookies.map((c) => c.name),
    'no session cookie left',
  ).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: SIGNED_OUT })).toBeVisible();
});

test('Continue with Google sends the visitor to Google for our app', async ({ page }) => {
  skipOnProduction();
  // The click is real and so is our server's answer, but the browser stops there: the test
  // reads where the answer sends it, then follows the way to Google itself, one step at a time,
  // without ever loading Google's sign-in page.
  let toSupabase: URL | undefined;
  await page.route('**/auth/google', async (route) => {
    const answer = await route.fetch({ maxRedirects: 0 });
    expect(answer.status(), 'our server answers with a redirect').toBe(303);
    toSupabase = new URL(answer.headers().location ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Stopped by the test</title><h1>On the way to Google</h1>',
    });
  });
  await page.goto('/sign-in-test');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveTitle('Stopped by the test');

  const project = process.env.SUPABASE_URL?.replace(/\/$/, '');
  expect(toSupabase?.pathname, "to Supabase's sign-in").toBe('/auth/v1/authorize');
  expect(toSupabase?.searchParams.get('provider')).toBe('google');
  if (project) expect(toSupabase?.origin).toBe(project);

  const fromSupabase = await page.request.get(toSupabase?.href ?? '', { maxRedirects: 0 });
  const google = new URL(fromSupabase.headers().location ?? '');
  expect(google.host, "then to Google's sign-in").toBe('accounts.google.com');
  expect(google.searchParams.get('client_id'), "with our Google client's ID").toMatch(
    /\.apps\.googleusercontent\.com$/,
  );
  // Google is asked to return to our own Supabase project's sign-in callback.
  expect(google.searchParams.get('redirect_uri')).toBe(
    `${project ?? toSupabase?.origin}/auth/v1/callback`,
  );
});
