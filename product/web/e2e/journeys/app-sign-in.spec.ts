import { readBotCheckMessage } from '@hrizzup/core';
import { expect, type Page, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  deleteJourneyAccount,
  type Engine,
  journeyAddress,
  readSignInCode,
  stagingKeys,
} from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: our server's half of the app's sign-in (PLAN.md step 1.6b), called as the app calls it.
 * - The app's settings: Supabase's address and publishable key, from the typed API.
 * - The bot check the app shows in a small web view hands its answer to the app.
 * - That answer and an address, sent to the typed API, get an email code; the code, checked with
 *   Supabase as the app checks it, gives a session whose token answers who-am-I.
 * - Where the bot check is real (staging), an answer it didn't give is refused and nothing is sent.
 */

test.use(phone);

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** Cloudflare's published test site keys that always pass (shown, and not shown). */
const PASSING_TEST_SITE_KEYS = ['1x00000000000000000000AA', '1x00000000000000000000BB'];

/** Whether a test can pass the bot check: previews, or this Mac run with a test key. */
function botCheckIsATest() {
  return (
    environment() === 'preview' ||
    PASSING_TEST_SITE_KEYS.includes(process.env.TURNSTILE_SITE_KEY ?? '')
  );
}

function skipOnProduction() {
  test.skip(environment() === 'production', "The app's sign-in isn't on production until launch");
}

/**
 * Opens the bot check page as the app's web view does, with the app's side of the message
 * channel stood in for, and returns the messages the page sends.
 */
async function openAsTheApp(page: Page) {
  await page.addInitScript(() => {
    const sent: string[] = [];
    Object.assign(window, {
      sentToTheApp: sent,
      ReactNativeWebView: { postMessage: (message: string) => sent.push(message) },
    });
  });
  await page.goto('/auth/app/bot-check');
  return async () =>
    (await page.evaluate(() => (window as unknown as { sentToTheApp: string[] }).sentToTheApp))
      .map(readBotCheckMessage)
      .filter((message) => message !== null);
}

test("the app's sign-in settings are Supabase's address and publishable key", async ({
  request,
}) => {
  const answer = await request.get('/api/v1/auth/settings');
  if (environment() === 'production') {
    expect(answer.status()).toBe(503);
    return;
  }
  expect(answer.status()).toBe(200);
  const settings = await answer.json();
  expect(settings.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  expect(typeof settings.publishableKey).toBe('string');
  const keys = stagingKeys();
  if (keys) {
    expect(settings.supabaseUrl).toBe(keys.url);
    expect(settings.publishableKey === keys.publishableKey, "staging's publishable key").toBe(true);
  }
  expect(answer.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
});

test('the bot check page hands its answer to the app', async ({ page }) => {
  skipOnProduction();
  const received = await openAsTheApp(page);
  await expect(
    page.getByRole('heading', { name: "A quick check that you're not a bot" }),
  ).toBeVisible();
  // The app learns how tall the page is, to fit its web view to it, and nothing went wrong.
  await expect.poll(async () => (await received()).some((m) => m.kind === 'height')).toBe(true);
  expect((await received()).filter((m) => m.kind === 'error')).toEqual([]);
  test.skip(!botCheckIsATest(), 'The real bot check is for people: a test may not pass it');
  await expect
    .poll(async () => (await received()).find((m) => m.kind === 'answer'), { timeout: 30_000 })
    .toBeTruthy();
});

test('an email code asked for through the typed API signs the app in', async ({
  page,
  request,
  browserName,
}) => {
  skipOnProduction();
  test.skip(!botCheckIsATest(), 'The real bot check is for people: a test may not pass it');
  // One email per run is enough (the call is the same for every browser), since Supabase sends at
  // most 30 an hour for staging and every preview together.
  test.skip(browserName !== 'chromium', 'One email a run: Chromium asks for it');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing, so no code can be read");
  const email = journeyAddress('code', browserName as Engine);
  try {
    const received = await openAsTheApp(page);
    let answer: string | undefined;
    await expect
      .poll(
        async () => {
          const message = (await received()).find((m) => m.kind === 'answer');
          answer = message?.kind === 'answer' ? message.answer : undefined;
          return answer;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    // The app's request: JSON, from no browser page (no Origin), with the address and the answer.
    const sent = await request.post('/api/v1/auth/email/code', {
      data: { email: email.toUpperCase(), botCheck: answer },
    });
    expect(
      sent.status(),
      `the code is sent (Supabase sends at most one email a minute to an address, and 30 an hour for staging and every preview together): ${await sent.text()}`,
    ).toBe(200);
    expect(await sent.json()).toEqual({ email, codeLength: 8, minutes: 10 });
    expect(sent.headers()['cache-control']).toBe('private, no-store');

    // No inbox is read: staging's admin access gives a working code for the address. The app
    // checks it with Supabase itself, with the publishable key, and keeps the session.
    const code = await readSignInCode(keys, email);
    const app = createClient(keys.url, keys.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await app.auth.verifyOtp({ email, token: code, type: 'email' });
    expect(error, 'the code signs in').toBeNull();
    const token = data.session?.access_token;
    expect(token, 'a session').toBeTruthy();

    const me = await request.get('/api/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ email, signedInWith: 'email' });
    await app.auth.signOut({ scope: 'local' });
  } finally {
    await deleteJourneyAccount(keys, email);
  }
});

test("where the bot check is real, an answer it didn't give is refused and nothing is sent", async ({
  request,
}) => {
  skipOnProduction();
  test.skip(botCheckIsATest(), "Previews use Cloudflare's test keys, which pass every answer");
  // Cloudflare's own dummy answer, which only its test keys accept.
  const refused = await request.post('/api/v1/auth/email/code', {
    data: { email: 'delivered+never-sent@resend.dev', botCheck: 'XXXX.DUMMY.TOKEN.XXXX' },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ code: 'BOT_CHECK_FAILED' });
});
