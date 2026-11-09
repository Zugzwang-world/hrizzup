import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  type Engine,
  ensureTestAccount,
  stagingKeys,
  TEST_ACCOUNTS,
} from '../support/test-accounts.ts';

/**
 * Journey: the typed API at /api/v1 (PLAN.md step 1.5c), called as the app calls it, over HTTP.
 * - its public read answers, and Vercel's edge serves it from its cache the second time;
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
  const second = await request.get('/api/v1/health');
  expect(second.status()).toBe(200);
  expect(second.headers()['x-vercel-cache'], 'the second answer comes from the edge').toMatch(
    /^(HIT|STALE)$/,
  );
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
  const email = TEST_ACCOUNTS[browserName as Engine];
  await ensureTestAccount(keys, email);
  // The app signs in with its own token; this is that token, from a fresh one-time sign-in.
  const admin = createClient(keys.url, keys.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const app = createClient(keys.url, keys.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let token: string | undefined;
  for (let attempt = 1; attempt <= 5 && !token; attempt++) {
    const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const hash = data.properties?.hashed_token ?? '';
    const { data: signedIn } = await app.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    token = signedIn.session?.access_token;
    if (!token) await new Promise((r) => setTimeout(r, 500 + Math.random() * 2000));
  }
  expect(token, 'a session for the test account').toBeTruthy();
  const answered = await request.get('/api/v1/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(answered.status()).toBe(200);
  expect(await answered.json()).toMatchObject({ email, signedInWith: 'test_account' });
  expect(answered.headers()['cache-control']).toBe('private, no-store');
  // Only this session: the test account is shared with other runs, whose sessions a
  // global sign-out would end (supabase-js signs out everywhere unless told otherwise).
  await app.auth.signOut({ scope: 'local' });
});
