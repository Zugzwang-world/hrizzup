import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { accessTokenFromCookies } from '../../lib/api/context.ts';
import { engineAccount } from '../support/run.ts';
import { signedInState } from '../support/states.ts';
import { type Engine, stagingKeys } from '../support/test-accounts.ts';

/**
 * Journey: the typed API at /api/v1 (PLAN.md step 1.5c), called as the app calls it, over HTTP.
 * - its public read answers, and Vercel's edge serves it from its cache within seconds;
 * - an input the call doesn't take is refused;
 * - who-am-I refuses a visitor who isn't signed in, and answers the test account's own token.
 */

const onVercel = () =>
  ['preview', 'staging', 'production'].includes(process.env.SCREEN_CHECK_ENVIRONMENT ?? '');

test('the public read answers, and the edge keeps it', async ({ request }) => {
  const first = await request.get('/api/v1/health');
  expect(first.status()).toBe(200);
  const body = await first.json();
  expect(body).toMatchObject({ environment: process.env.SCREEN_CHECK_ENVIRONMENT });
  expect(first.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
  test.skip(!onVercel(), "Only Vercel's edge keeps copies; this Mac's server doesn't");
  // The edge stores its copy a moment after the first answer, so the next asks again for a few
  // seconds, as the trading journey does: a copy must come from the edge within them.
  let cached = '';
  for (let attempt = 0; attempt < 10 && !/^(HIT|STALE)$/.test(cached); attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
    const again = await request.get('/api/v1/health');
    expect(again.status()).toBe(200);
    cached = again.headers()['x-vercel-cache'] ?? '';
  }
  expect(cached, 'an answer comes from the edge within seconds').toMatch(/^(HIT|STALE)$/);
});

test('an input the call does not take is refused', async ({ request }) => {
  const refused = await request.get('/api/v1/health?unexpected=1');
  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ code: 'BAD_REQUEST' });
  expect(refused.headers()['cache-control']).toBe('private, no-store');
});

test('who-am-I refuses a stranger and answers the signed-in account', async ({
  request,
  browserName,
}) => {
  const stranger = await request.get('/api/v1/me');
  expect(stranger.status()).toBe(401);
  expect(stranger.headers()['cache-control']).toBe('private, no-store');

  test.skip(
    process.env.SCREEN_CHECK_ENVIRONMENT === 'production',
    'No test accounts on production',
  );
  const keys = stagingKeys();
  if (!keys)
    throw new Error("Staging's Supabase keys are missing, so the test account can't sign in");
  // The engine's own account of this run (made by global-setup.ts).
  const email = engineAccount(browserName as Engine);
  // The app signs in with its own token: here, the access token of the engine account's session
  // that global-setup.ts made, read from its cookies exactly as the API reads them, so the run
  // signs in no more often than it must (staging allows 30 sign-ins in 5 minutes per address).
  const saved = JSON.parse(await readFile(signedInState(browserName), 'utf8')) as {
    cookies: { name: string; value: string }[];
  };
  const token = await accessTokenFromCookies(
    saved.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    keys.url,
  );
  expect(token, 'a session for the test account').toBeTruthy();
  const answered = await request.get('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(answered.status()).toBe(200);
  expect(await answered.json()).toMatchObject({ email, signedInWith: 'test_account' });
  expect(answered.headers()['cache-control']).toBe('private, no-store');
});
