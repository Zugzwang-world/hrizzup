import { mkdir, writeFile } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';
import {
  CONSOLE_FIXTURE_MARKET,
  CONSOLE_FIXTURE_PERP,
  FIXTURE_PERP_NAME,
  SANDBOX_FIXTURE_MARKET,
  SANDBOX_FIXTURE_QUESTION,
} from './pages.ts';
import { asBrowserCookie, BYPASS_COOKIE, bypassCookieValue } from './support/bypass.ts';
import { ensureFixtureMarket, type FixtureMarket } from './support/fixture-markets.ts';
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
 * unlisted, for the screen check of a market's page (`ensureFixtureMarket`), and the markets
 * sandbox's, open and listed (the sandbox finds a market through the public list): the markets runs
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
    await ensureFixtureMarket(baseURL, { ...headers, cookie }, CONSOLE_MARKET);
    await ensureFixtureMarket(baseURL, { ...headers, cookie }, SANDBOX_MARKET);
    await ensureFixturePerp(baseURL, { ...headers, cookie });
  }
}

const CONSOLE_MARKET: FixtureMarket = {
  id: CONSOLE_FIXTURE_MARKET,
  question: "Screen check: a test market kept on staging for the console's screen check",
  rules:
    "A test market for the market console's screen check, on staging only.\nIt is settled Yes once, by the screen check's admin test account, and kept.",
  listed: false,
  closesInDays: 1,
  leftIn: ['settled'],
  evidence: "Settled Yes for the console's screen check.",
};

const SANDBOX_MARKET: FixtureMarket = {
  id: SANDBOX_FIXTURE_MARKET,
  question: SANDBOX_FIXTURE_QUESTION,
  rules:
    "A test market for the markets sandbox's page checks, on staging only.\nIt is opened once, by the screen check's admin test account, and kept open: nothing trades it.",
  listed: true,
  closesInDays: 5 * 365,
  // Anyone with the console may close or settle it, and trade it: the page renders all the same.
  leftIn: ['open', 'closed', 'settled'],
};

/**
 * The console's fixture test perp (pages.ts, CONSOLE_FIXTURE_PERP): made once, switched off, by the
 * admin test account through the console's call, and found again by its ID on every later run (a
 * second make, by another run at the same moment, gets back the same perp). Nothing ever trades it
 * or switches it on, so the screen check sees a perp page whose log names only the test account.
 */
async function ensureFixturePerp(baseURL: string, headers: Record<string, string>) {
  const response = await fetch(new URL('/api/v1/admin/perps', baseURL), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: CONSOLE_FIXTURE_PERP,
      name: FIXTURE_PERP_NAME,
      // Not a secret: nothing ever trades this perp.
      seed: '5c4ee9c4ec6e1f00',
      standIn: { origin: '2026-11-10T00:00:00.000Z', startPrice: '100', volatility: '0.55' },
      settings: {
        maxLeverage: '10',
        takerFeeBps: '10',
        takerFeeImpact: '0',
        fundingPeriodMs: '3600000',
        fundingSensitivity: '1',
        maxFundingRate: '0.0001',
        maxPriceAgeMs: '120000',
        subsidyLong: '1000',
        subsidyShort: '1000',
      },
      reason: "Kept on staging for the console's screen check: switched off, never traded",
    }),
  });
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Couldn't make the console's fixture perp (${response.status})`);
  }
}
