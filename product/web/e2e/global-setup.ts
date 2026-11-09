import { mkdir, writeFile } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
import { asBrowserCookie, BYPASS_COOKIE, bypassCookieValue } from './support/bypass.ts';
import { signedInState, signedOutState, statesFolder } from './support/states.ts';
import {
  type Engine,
  stagingKeys,
  sweepJourneyAccounts,
  TEST_ACCOUNTS,
  testSessionCookies,
} from './support/test-accounts.ts';

/**
 * Before the screen check and the journeys: find out which environment the address under test
 * is (from its /api/health), and save each browser engine's starting states:
 * - signed out: on a protected deployment, only Vercel's bypass cookie (support/bypass.ts), so
 *   the bypass secret itself never travels with the browser's requests;
 * - signed in, outside production: the same, plus a fresh session for the engine's test
 *   account (support/test-accounts.ts).
 * Outside production it also deletes any account a sign-in journey made for itself that a
 * broken run left behind (support/test-accounts.ts, `sweepJourneyAccounts`).
 * The states go in a temporary folder outside the repository (support/states.ts), never
 * uploaded, and deleted when the run ends (global-teardown.ts).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers: Record<string, string> = secret ? { 'x-vercel-protection-bypass': secret } : {};

  const response = await fetch(new URL('/api/health', baseURL), { headers, redirect: 'manual' });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`${baseURL}/api/health answered ${response.status}; is the address right?`);
  }
  const { environment } = (await response.json()) as { environment: string };
  process.env.SCREEN_CHECK_ENVIRONMENT = environment;

  await mkdir(statesFolder(), { recursive: true, mode: 0o700 });
  const bypass = secret
    ? [asBrowserCookie(baseURL, BYPASS_COOKIE, await bypassCookieValue(baseURL, secret))]
    : [];
  const keys = environment === 'production' ? null : stagingKeys();
  if (keys) await sweepJourneyAccounts(keys);
  for (const engine of Object.keys(TEST_ACCOUNTS) as Engine[]) {
    const save = (file: string, cookies: typeof bypass) =>
      writeFile(file, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
    await save(signedOutState(engine), bypass);
    if (!keys) continue;
    const session = await testSessionCookies(keys, TEST_ACCOUNTS[engine]);
    await save(signedInState(engine), [
      ...bypass,
      ...session.map(({ name, value }) => asBrowserCookie(baseURL, name, value)),
    ]);
  }
}
