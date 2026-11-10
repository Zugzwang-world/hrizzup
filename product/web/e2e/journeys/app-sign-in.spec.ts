import { readBotCheckMessage } from '@hrizzup/core';
import { expect, type Page, test } from '@playwright/test';
import { stagingKeys } from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: our server's half of the app's sign-in (PLAN.md step 1.6b), called as the app calls it.
 * - The app's settings: Supabase's address and publishable key, from the typed API.
 * - The bot check the app shows in a small web view hands its answer to the app.
 * - Where the bot check is real (staging), an answer it didn't give is refused and nothing is sent.
 *
 * No email is sent here: staging's 30 emails an hour are shared by every preview's checks and the
 * founder's own sign-ins, and they ran out on 10 November 2026 with three relays' checks running.
 * Supabase sending a code with the server key is proven by the website's own email journey
 * (sign-in.spec.ts), and the call's every answer by its unit tests (app/api/v1/…/auth.test.ts).
 * - Supabase sends the phone's browser back from Google to the app's own address, and to no other.
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

test("Supabase sends the phone's browser back from Google to the app's own address, and no other", async ({
  request,
}) => {
  skipOnProduction();
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing");
  // As the website's Google journey does: Supabase's verify step, given a code that's no good,
  // sends the browser to the address asked for if its allow-list has it, and to staging's home
  // otherwise, so this asks without signing anyone in (infra/supabase/auth/settings.json).
  const wayBack = async (to: string) => {
    const verify = new URL('/auth/v1/verify', keys.url);
    verify.searchParams.set('token', 'not-a-real-code');
    verify.searchParams.set('type', 'magiclink');
    verify.searchParams.set('redirect_to', to);
    const answer = await request.get(verify.href, { maxRedirects: 0 });
    expect(answer.status()).toBe(303);
    return answer.headers().location ?? '';
  };
  expect(await wayBack('hrizzup://auth/callback')).toMatch(/^hrizzup:\/\/auth\/callback[#?]/);
  for (const other of ['hrizzup://auth/elsewhere', 'hrizzup://evil', 'otherapp://auth/callback']) {
    expect(await wayBack(other), other).toMatch(/^https:\/\/staging\.hrizzup\.com[/#?]/);
  }
});
