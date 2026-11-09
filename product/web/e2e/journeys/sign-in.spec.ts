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
 * goes through the page's own button. Google sign-in itself is followed up to Google's door,
 * and Supabase is shown to allow the way back to this site (on this Mac, each slot's own
 * address: infra/slots/README.md).
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

test('Continue with Google goes to Google for our app, and Supabase allows the way back', async ({
  page,
}) => {
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

  // And Supabase will send the visitor back the way our server asked: to this site's own
  // callback (on a preview, staging's relay), which only its redirect list allows
  // (infra/supabase/auth/settings.json). Supabase's verify step, given a code that's no good,
  // sends the browser to that address if the list allows it and to staging's home otherwise,
  // so this asks without signing anyone in, without a key and without touching an account.
  const wayBack = toSupabase?.searchParams.get('redirect_to') ?? '';
  expect(wayBack, 'our server names a way back').not.toBe('');
  const verify = new URL('/auth/v1/verify', toSupabase?.origin);
  verify.searchParams.set('token', 'not-a-real-code');
  verify.searchParams.set('type', 'magiclink');
  verify.searchParams.set('redirect_to', wayBack);
  const answer = await page.request.get(verify.href, { maxRedirects: 0 });
  expect(answer.status()).toBe(303);
  // Compared as addresses (place, then each parameter), so a re-encoded character can't matter.
  const address = (href: string) => {
    const url = new URL(href);
    return { at: url.origin + url.pathname, with: [...url.searchParams].sort() };
  };
  expect(
    address(answer.headers().location ?? 'about:blank'),
    "Supabase's redirect list allows this site's way back",
  ).toEqual(address(wayBack));
});
