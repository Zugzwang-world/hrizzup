import { mkdir, writeFile } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
import { CONSOLE_FIXTURE_MARKET } from './pages.ts';
import { asBrowserCookie, BYPASS_COOKIE, bypassCookieValue } from './support/bypass.ts';
import { adminState, signedInState, signedOutState, statesFolder } from './support/states.ts';
import {
  ADMIN_TEST_ACCOUNT,
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
 * - as the market console's admin test account, outside production: one session, shared by both
 *   engines (each sign-in counts against staging's limit of 30 a 5 minutes from one address, and
 *   a run is over long before the session's hour is up), for the console's screen check and
 *   journeys.
 * Outside production it also deletes any account a sign-in journey made for itself that a
 * broken run left behind (support/test-accounts.ts, `sweepJourneyAccounts`), and makes sure the
 * console's fixture market exists, settled, for the screen check of a market's page
 * (`ensureFixtureMarket`).
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
  const admin = keys ? await testSessionCookies(keys, ADMIN_TEST_ACCOUNT) : [];
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
    await save(adminState(engine), [
      ...bypass,
      ...admin.map(({ name, value }) => asBrowserCookie(baseURL, name, value)),
    ]);
  }
  if (keys) {
    // The same session, as the website's own cookies, for the console's calls.
    const cookie = admin.map(({ name, value }) => `${name}=${value}`).join('; ');
    await ensureFixtureMarket(baseURL, { ...headers, cookie });
  }
}

/**
 * The console's fixture market (pages.ts, CONSOLE_FIXTURE_MARKET): made, opened, closed and
 * settled Yes through the console's calls the first time, as the admin test account, and found
 * again by its ID on every later run, so the screen check sees a market page with its whole log.
 */
async function ensureFixtureMarket(baseURL: string, headers: Record<string, string>) {
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(new URL(`/api/v1/admin/markets${path}`, baseURL), {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer = (await response.json()) as { state?: string; message?: string };
    return { status: response.status, answer };
  };
  let found = await call(`/${CONSOLE_FIXTURE_MARKET}`);
  if (found.status === 404 && found.answer.message === 'No such call') {
    throw new Error(
      "The console's admin test account isn't an admin here (infra/supabase/migrations/*_staging_admins.sql)",
    );
  }
  if (found.status === 404) {
    found = await call('', 'POST', {
      id: CONSOLE_FIXTURE_MARKET,
      question: "Screen check: a test market kept on staging for the console's screen check",
      categories: ['general'],
      rules:
        "A test market for the market console's screen check, on staging only.\nIt is settled Yes once, by the screen check's admin test account, and kept.",
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }
  const steps: Record<string, [string, unknown?]> = {
    draft: ['/open'],
    open: ['/close'],
    closed: [
      '/settle',
      { outcome: 'yes', evidence: "Settled Yes for the console's screen check." },
    ],
  };
  for (let state = found.answer.state; state && steps[state]; ) {
    const [step, body] = steps[state] as [string, unknown?];
    const next = await call(`/${CONSOLE_FIXTURE_MARKET}${step}`, 'POST', body);
    if (next.status !== 200) {
      throw new Error(`The console's fixture market couldn't ${step.slice(1)} (${next.status})`);
    }
    state = next.answer.state;
  }
}
