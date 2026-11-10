import { mkdir, writeFile } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
import { CONSOLE_FIXTURE_MARKET } from './pages.ts';
import { asBrowserCookie, BYPASS_COOKIE, bypassCookieValue } from './support/bypass.ts';
import { engineAccount, runKey } from './support/run.ts';
import { adminState, signedInState, signedOutState, statesFolder } from './support/states.ts';
import {
  ADMIN_TEST_ACCOUNT,
  ENGINES,
  stagingKeys,
  testSessionCookies,
} from './support/test-accounts.ts';

/**
 * Before the screen check and the journeys: find out which environment the address under test
 * is (from its /api/health), and save each browser engine's starting states:
 * - signed out: on a protected deployment, only Vercel's bypass cookie (support/bypass.ts), so
 *   the bypass secret itself never travels with the browser's requests;
 * - signed in, outside production: the same, plus a session for the engine's own account of this
 *   run, made now (support/run.ts, `engineAccount`): every run has its own, so no two runs ever
 *   share one;
 * - as the market console's admin test account, outside production: one session, shared by both
 *   engines (each sign-in counts against staging's limit of 30 a 5 minutes from one address, and
 *   a run is over long before the session's hour is up), for the console's screen check and
 *   journeys, which use it only for the run's own markets.
 * Outside production it also makes sure the console's fixture market exists, settled and
 * unlisted, for the screen check of a market's page (`ensureFixtureMarket`): the one market runs
 * share, and only ever read. Every journey that trades makes its own accounts and its own market.
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
  console.log(`Check run ${runKey()}: its accounts and markets carry this key`);
  const admin = keys ? await testSessionCookies(keys, ADMIN_TEST_ACCOUNT) : [];
  for (const engine of ENGINES) {
    const save = (file: string, cookies: typeof bypass) =>
      writeFile(file, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
    await save(signedOutState(engine), bypass);
    if (!keys) continue;
    const session = await testSessionCookies(keys, engineAccount(engine), { create: true });
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
 * The console's fixture market (pages.ts, CONSOLE_FIXTURE_MARKET): made (unlisted, a test market),
 * opened, closed and settled Yes through the console's calls the first time, as the admin test
 * account, and found again by its ID on every later run, so the screen check sees a market page
 * with its whole log.
 * Several runs can do this at once (checks of other pull requests, this Mac): making it twice
 * gets back the same market, and a step another run has already taken is taken as done, so it
 * always ends settled, or the run fails saying why.
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
  const read = async (): Promise<string | null> => {
    const found = await call(`/${CONSOLE_FIXTURE_MARKET}`);
    if (found.status === 404 && found.answer.message === 'No such call') {
      throw new Error(
        "The console's admin test account isn't an admin here (infra/supabase/migrations/*_staging_admins.sql)",
      );
    }
    if (found.status === 404) return null;
    if (found.status !== 200) {
      throw new Error(`Couldn't read the console's fixture market (${found.status})`);
    }
    return found.answer.state ?? null;
  };
  const steps: Record<string, [string, unknown]> = {
    draft: ['/open', {}],
    open: ['/close', {}],
    closed: [
      '/settle',
      { outcome: 'yes', evidence: "Settled Yes for the console's screen check." },
    ],
  };

  let state = await read();
  if (state === null) {
    // Another run making it at the same moment gets back the same market (its ID is fixed).
    const made = await call('', 'POST', {
      id: CONSOLE_FIXTURE_MARKET,
      question: "Screen check: a test market kept on staging for the console's screen check",
      categories: ['general'],
      rules:
        "A test market for the market console's screen check, on staging only.\nIt is settled Yes once, by the screen check's admin test account, and kept.",
      source: { name: "Hrizzup's test desk (a placeholder source)" },
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
      listed: false,
    });
    if (made.status !== 201) {
      throw new Error(`Couldn't make the console's fixture market (${made.status})`);
    }
    state = made.answer.state ?? null;
  }
  for (let attempts = 0; state && steps[state] && attempts < 6; attempts++) {
    const [step, body] = steps[state] as [string, unknown];
    const next = await call(`/${CONSOLE_FIXTURE_MARKET}${step}`, 'POST', body);
    if (next.status === 200) {
      state = next.answer.state ?? null;
    } else if (next.status === 409) {
      // Another run took this step first: read where the market is now, and go on from there.
      state = await read();
    } else {
      throw new Error(`The console's fixture market couldn't ${step.slice(1)} (${next.status})`);
    }
  }
  if (state !== 'settled') {
    throw new Error(`The console's fixture market ended ${state ?? 'missing'}, not settled`);
  }
}
