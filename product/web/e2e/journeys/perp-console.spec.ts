import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { BITCOIN_PERP } from '../pages.ts';
import { runKey } from '../support/run.ts';
import { adminState, signedInState } from '../support/states.ts';
import { ADMIN_TEST_ACCOUNT } from '../support/test-accounts.ts';
import { phone } from './phone.ts';

/**
 * Journey: the perp's console (PLAN.md step 3.4a), over HTTP and in the browser, in Chromium and
 * WebKit.
 * - To anyone but an admin, signed in or not, and whatever they send, every one of its calls answers
 *   exactly as an address the API doesn't have; on production, until launch, to everyone.
 * - An admin makes the run's own test perp (unlisted, switched off, its pools seeded by the house),
 *   switches it on, to closing only and off again with the console's form, changes a setting, sees
 *   every change in its rule-change log with the reason given, has a setting past its bound refused,
 *   and retires the perp: its pools go back to the house.
 * Each run makes and retires its own test perps (support/run.ts), never touching the Bitcoin perp.
 */
test.use(phone);

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** A request the way a page on the site sends one: from inside it, with its own cookies. */
async function fromPage(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(
    async ({ method, path, data }) => {
      const response = await fetch(path, {
        method,
        headers: data === undefined ? {} : { 'content-type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    { method, path, data },
  );
}

/** The run's own test perp: unlisted, switched off, Ṁ1,000 of the house's in each pool. */
function testPerp(name: string) {
  return {
    id: newRecordId(),
    name,
    seed: [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    standIn: {
      origin: new Date(Date.now() - 60_000).toISOString(),
      startPrice: '100',
      volatility: '40',
    },
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
    reason: `The console journey's own test perp (run ${runKey()})`,
  };
}

async function asAdmin(browser: Browser, browserName: string): Promise<Page> {
  const context = await browser.newContext({ ...phone, storageState: adminState(browserName) });
  return context.newPage();
}

/** Headers that differ from one answer to the next by their nature (the time, the request's ID). */
const PER_ANSWER = new Set([
  'date',
  'age',
  'x-vercel-id',
  'x-vercel-cache',
  'connection',
  'keep-alive',
]);

async function call(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await request.fetch(path, { method, headers, ...(data ? { data } : {}) });
  return {
    status: response.status(),
    text: await response.text(),
    caching: response.headers()['cache-control'],
    headers: Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => !PER_ANSWER.has(name)),
    ),
  };
}

test("the perp console's calls answer anyone but an admin as an address the API doesn't have", async ({
  request,
  playwright,
  baseURL,
  browserName,
}) => {
  const unknown = await call(request, 'GET', '/api/v1/no-such-call');
  expect(unknown.status).toBe(404);
  const id = newRecordId();
  const calls: [string, string, unknown?, Record<string, string>?][] = [
    ['GET', '/api/v1/admin/perps'],
    ['GET', `/api/v1/admin/perps/${BITCOIN_PERP}`],
    ['GET', `/api/v1/admin/perps/${id}`],
    ['POST', `/api/v1/admin/perps/${BITCOIN_PERP}/mode`, { mode: 'enabled', reason: 'Mine now' }],
    [
      'POST',
      `/api/v1/admin/perps/${BITCOIN_PERP}/settings`,
      { settings: { maxLeverage: '10' }, reason: 'x' },
    ],
    ['POST', '/api/v1/admin/perps', testPerp('Not a perp of the run’s at all')],
    ['POST', '/api/v1/admin/perps', '{', { 'content-type': 'application/json' }],
    ['POST', `/api/v1/admin/perps/${BITCOIN_PERP}/retire`, { reason: 'x' }],
    ['POST', '/api/v1//admin/perps', '{', { 'content-type': 'application/json' }],
  ];
  const strangers: { who: string; as: APIRequestContext }[] = [{ who: 'signed out', as: request }];
  if (environment() !== 'production') {
    strangers.push({
      who: 'signed in, not an admin',
      as: await playwright.request.newContext({
        ...(baseURL ? { baseURL } : {}),
        storageState: signedInState(browserName),
      }),
    });
  }
  // On staging itself, Vercel's Security Checkpoint answers every write from anything but a browser
  // before it reaches the API (journeys/console-api.spec.ts says why), so there only reads compare.
  const sent = calls.filter(([method]) => environment() !== 'staging' || method === 'GET');
  for (const { who, as } of strangers) {
    for (const [method, path, data, headers] of sent) {
      const answer = await call(as, method, path, data, headers ?? {});
      const what = `${who}: ${method} ${path}`;
      expect(answer.status, what).toBe(404);
      expect(answer.text, what).toBe(unknown.text);
      expect(answer.headers, what).toEqual(unknown.headers);
      expect(answer.caching, what).toBe('private, no-store');
    }
  }
});

test("an admin runs the run's own test perp: switches it on and off, changes a setting, retires it; the log shows each change and why", async ({
  browser,
  browserName,
}) => {
  test.skip(environment() === 'production', "The console doesn't exist on production until launch");
  const page = await asAdmin(browser, browserName);
  await page.goto('/console');
  await expect(page.getByRole('heading', { level: 1, name: 'Market console' })).toBeVisible();
  // The Bitcoin perp is always listed first in the console, switched off on staging until 3.4a's
  // done-test switches it on; nothing here touches it.
  await expect(page.getByTestId('perp-list').getByRole('link').first()).toHaveText(
    'Bitcoin price (US dollars)',
  );

  // The run's own test perp, made through the console's call from the page (as a browser sends it).
  const perp = testPerp(`Console journey (${browserName}, run ${runKey()})`);
  try {
    await runsTheTestPerp(page, perp);
  } finally {
    // Whatever happened, the run's perp ends switched off and retired (a retire asked again
    // answers with the retired perp), so nothing of the run's is left live on staging.
    await fromPage(page, 'POST', `/api/v1/admin/perps/${perp.id}/mode`, {
      mode: 'halted',
      reason: `The console journey cleans up (run ${runKey()})`,
    }).catch(() => undefined);
    await fromPage(page, 'POST', `/api/v1/admin/perps/${perp.id}/retire`, {
      reason: `The console journey cleans up (run ${runKey()})`,
    }).catch(() => undefined);
    await page.context().close();
  }
});

async function runsTheTestPerp(page: Page, perp: ReturnType<typeof testPerp>) {
  const made = await fromPage(page, 'POST', '/api/v1/admin/perps', perp);
  expect(made.status).toBe(201);
  expect(made.body).toMatchObject({
    id: perp.id,
    listed: false,
    tradingMode: 'halted',
    pools: { long: '1000.000000', short: '1000.000000' },
  });
  // A retried make gets the same perp back; the same ID for another perp is refused.
  expect((await fromPage(page, 'POST', '/api/v1/admin/perps', perp)).body).toMatchObject({
    id: perp.id,
  });
  expect(
    (await fromPage(page, 'POST', '/api/v1/admin/perps', { ...perp, name: 'Another perp' })).status,
  ).toBe(400);

  await page.goto(`/console/perps/${perp.id}`);
  await expect(page.getByRole('heading', { level: 1, name: perp.name })).toBeVisible();
  await expect(page.getByTestId('perp-mode')).toHaveText('Off (halted)');
  await expect(page.getByTestId('perp-listed')).toContainText('Unlisted');
  await expect(page.getByTestId('perp-pools')).toHaveText('Ṁ1,000 long, Ṁ1,000 short');

  // The off switch: on, with the reason, at once.
  const modeForm = page.getByTestId('perp-mode-form');
  await modeForm.getByRole('radio', { name: /^On/ }).check();
  await modeForm.getByLabel('Why').fill('The console journey switches it on');
  await modeForm.getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByTestId('perp-mode')).toHaveText('On');
  const log = page.getByTestId('perp-log');
  await expect(log.getByRole('listitem').last()).toContainText(
    'The off switch: Off (halted) to On',
  );
  await expect(log.getByRole('listitem').last()).toContainText(`by ${ADMIN_TEST_ACCOUNT}`);
  await expect(log.getByRole('listitem').last()).toContainText(
    'Why: The console journey switches it on',
  );

  // Closing only, then off again.
  await modeForm.getByRole('radio', { name: /^Closing only/ }).check();
  await modeForm.getByLabel('Why').fill('Winding down');
  await modeForm.getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByTestId('perp-mode')).toHaveText('Closing only');

  // A setting: 5 times leverage at most, logged; then 11, past the cap, refused.
  const settingsForm = page.getByTestId('perp-settings-form');
  await settingsForm.getByLabel('Most leverage').fill('5');
  await settingsForm.getByLabel('Why').fill('Gentler for this run');
  await settingsForm.getByRole('button', { name: 'Change the settings' }).click();
  await expect(log.getByRole('listitem').last()).toContainText('Most leverage: 10 to 5');
  await expect(log.getByRole('listitem').last()).toContainText('Why: Gentler for this run');
  await settingsForm.getByLabel('Most leverage').fill('11');
  await settingsForm.getByLabel('Why').fill('Too far');
  await settingsForm.getByRole('button', { name: 'Change the settings' }).click();
  await expect(page.getByTestId('console-refusal')).toBeVisible();
  await expect(log).not.toContainText('Too far');

  await modeForm.getByRole('radio', { name: /^Off/ }).check();
  await modeForm.getByLabel('Why').fill('The journey is done');
  await modeForm.getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByTestId('perp-mode')).toHaveText('Off (halted)');

  // Retired: switched off for good, holding nothing.
  const retired = await fromPage(page, 'POST', `/api/v1/admin/perps/${perp.id}/retire`, {
    reason: `The console journey is done (run ${runKey()})`,
  });
  expect(retired.status).toBe(200);
  expect(retired.body).toMatchObject({
    state: 'retired',
    pools: { long: '0.000000', short: '0.000000' },
  });
  await page.reload();
  await expect(page.getByTestId('perp-mode')).toHaveText('Retired');
  await expect(log.getByRole('listitem').last()).toContainText('Retired');
  // A retired perp is never switched on again.
  expect(
    (
      await fromPage(page, 'POST', `/api/v1/admin/perps/${perp.id}/mode`, {
        mode: 'enabled',
        reason: 'Again',
      })
    ).status,
  ).toBe(409);
}
