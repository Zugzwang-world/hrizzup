import { expect, test } from '@playwright/test';
import { PENDING_COOKIE, pendingCookieValue } from '../../lib/email-code.ts';
import { sendSignInCode } from '../../lib/supabase/send-code.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import {
  createJourneyAccount,
  deleteJourneyAccount,
  type Engine,
  journeyAddress,
  readSignInCode,
  stagingKeys,
  TEST_ACCOUNTS,
  testSessionCookies,
} from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: signing in and out, on the sign-in test page (staging, previews and this Mac; it
 * doesn't exist on production).
 * - The test account signs in the way the other checks do: a fresh session from staging's
 *   one-time token, set as the very cookies the website sets after a real sign-in
 *   (support/test-accounts.ts). Signing out then goes through the page's own button.
 * - A reader signs in with a code sent by email, through the page itself: the address, the
 *   bot check, the code, and signing out. Where the bot check is real (staging), it is for
 *   people, so the test asks for the code the way our server does once a person has passed it,
 *   and carries on from the page's code step.
 * - Google can't be signed into by a test, so Google sign-in is followed up to Google's door,
 *   and Supabase is shown to allow the way back to this site (on this Mac, each slot's own
 *   address: infra/slots/README.md).
 */

/** Cloudflare's published test site keys that always pass (shown, and not shown). */
const PASSING_TEST_SITE_KEYS = ['1x00000000000000000000AA', '1x00000000000000000000BB'];

/** Whether a test can pass the page's bot check: previews, or this Mac run with a test key. */
function botCheckIsATest() {
  return (
    process.env.SCREEN_CHECK_ENVIRONMENT === 'preview' ||
    PASSING_TEST_SITE_KEYS.includes(process.env.TURNSTILE_SITE_KEY ?? '')
  );
}
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

test('an email code signs a reader in, and out again', async ({
  page,
  context,
  baseURL,
  browserName,
}) => {
  skipOnProduction();
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no code can be read");

  // Chromium signs up a new reader; WebKit signs in one who already has an account. Each run
  // uses fresh addresses at Resend's test inbox (support/test-accounts.ts).
  const email = journeyAddress('code', browserName as Engine);
  if (browserName === 'webkit') await createJourneyAccount(keys, email);
  const tooMany =
    '(Supabase sends at most one email a minute to an address, and 30 an hour for staging ' +
    'and every preview together)';
  try {
    if (botCheckIsATest()) {
      await page.goto('/sign-in-test');
      await page.getByLabel('Email address').fill(email);
      await page.getByRole('button', { name: 'Email me a code' }).click();
    } else {
      // The real bot check is for people: ask for the code as our server does once one has
      // passed it, and remember the address in the cookie the server would set.
      const sent = await sendSignInCode(keys.url, keys.secretKey, email);
      if (sent !== 'sent') throw new Error(`No code was sent (${sent}) ${tooMany}`);
      const remembered = pendingCookieValue({ email, next: '/sign-in-test' });
      await context.addCookies([
        asBrowserCookie(baseURL ?? '', PENDING_COOKIE, encodeURIComponent(remembered)),
      ]);
      await page.goto('/sign-in-test');
    }
    // The code step, or the page's reason why not.
    const sentTo = page.getByTestId('code-sent-to');
    const problem = page.getByRole('main').getByRole('alert');
    await expect(sentTo.or(problem)).toBeVisible({ timeout: 30_000 });
    if (await problem.isVisible()) {
      throw new Error(`No code was sent: "${await problem.textContent()}" ${tooMany}`);
    }
    await expect(sentTo).toHaveText(email);

    // No inbox is read: staging's admin access gives a working code for the address.
    await page.getByLabel('Code', { exact: true }).fill(await readSignInCode(keys, email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: SIGNED_IN })).toBeVisible();
    await expect(page.getByTestId('signed-in-email')).toHaveText(email);
    await expect(page.getByText('An email code')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: SIGNED_OUT })).toBeVisible();
    const sessionCookies = (await context.cookies()).filter((c) => c.name.startsWith('sb-'));
    expect(sessionCookies, 'no session cookie left').toEqual([]);
  } finally {
    await deleteJourneyAccount(keys, email);
  }
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
