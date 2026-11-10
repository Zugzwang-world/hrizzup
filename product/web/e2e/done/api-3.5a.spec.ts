import { randomUUID } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { call, micros, settleAndCheckBooks } from '../support/books.ts';
import { asBrowserCookie } from '../support/bypass.ts';
import { runAddress, runKey } from '../support/run.ts';
import { adminState } from '../support/states.ts';
import { sessionFor, stagingKeys } from '../support/test-accounts.ts';

/**
 * PLAN.md step 3.5a's done-test, on staging itself: "a bot with a read-only key reads its positions
 * and is refused a trade, with a trading key it trades, and a revoked key is refused within
 * seconds; the docs page and the OpenAPI file describe every public call, llms.txt points AI tools
 * at them" (the docs page lists each call, each with a page of its own). (The last part, "a pull request that renames or removes a v1 field fails its checks",
 * is proven on every pull request: Quick checks run .github/scripts/test_api_breaking.py with the
 * real oasdiff.) Run by hand, once, from this Mac, never by the checks (about a minute):
 *
 *   infra/doppler/run stg -- sh -c 'cd product/web && BASE_URL=https://staging.hrizzup.com \
 *     pnpm exec playwright test --config playwright.done.config.ts e2e/done/api-3.5a.spec.ts'
 *
 * Every bot call goes as a bot sends it: no browser, no cookie, only its key. A fresh account of
 * the run's makes the keys, signed in; its trades are in the run's own unlisted test market, which
 * the console's admin test account makes, settles and checks to the millionth.
 */

const BASE = process.env.BASE_URL ?? '';

async function bot(
  playwright: { request: { newContext: (options: object) => Promise<APIRequestContext> } },
  key?: string,
) {
  return playwright.request.newContext({
    baseURL: BASE,
    ...(key ? { extraHTTPHeaders: { authorization: `Bearer ${key}` } } : {}),
  });
}

test("3.5a's done-test: keys, the ground rules and the docs, on staging", async ({
  playwright,
}) => {
  test.setTimeout(300_000);
  expect(BASE, 'run against staging').toBe('https://staging.hrizzup.com');
  const keys = stagingKeys();
  if (!keys) throw new Error("Staging's Supabase keys are missing (run with Doppler stg)");

  // The docs page, the OpenAPI file and llms.txt, as anyone (or any AI tool) reads them.
  const anyone = await bot(playwright);
  const file = await call(anyone, 'GET', '/api/v1/openapi.json');
  expect(file.status, 'the OpenAPI file').toBe(200);
  const paths = Object.entries(file.body.paths as Record<string, Record<string, unknown>>).flatMap(
    ([path, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
  );
  expect(paths.length).toBeGreaterThanOrEqual(12);
  const docs = await anyone.get('/docs');
  expect(docs.status(), 'the docs page').toBe(200);
  const page = await docs.text();
  for (const entry of paths) expect(page, `the docs page lists ${entry}`).toContain(entry);
  const operations = Object.values(
    file.body.paths as Record<string, Record<string, { operationId: string }>>,
  ).flatMap((item) => Object.values(item).map((operation) => operation.operationId));
  for (const id of operations) {
    const own = await anyone.get(`/docs/calls/${id}`);
    expect(own.status(), `${id} has a docs page of its own`).toBe(200);
  }
  const llms = await (await anyone.get('/llms.txt')).text();
  for (const link of ['/docs', '/llms-full.txt', '/api/v1/openapi.json']) {
    expect(llms, `llms.txt points at ${link}`).toContain(`${BASE}${link}`);
  }
  const full = await (await anyone.get('/llms-full.txt')).text();
  for (const entry of paths) expect(full, `llms-full.txt has ${entry}`).toContain(`### ${entry}`);

  // A fresh account of the run's, signed in, makes a read-only key and a trading key.
  const session = await sessionFor(keys, runAddress('done-3-5a', 'chromium'), { create: true });
  const person = await playwright.request.newContext({
    baseURL: BASE,
    storageState: {
      cookies: session.cookies.map(({ name, value }) => asBrowserCookie(BASE, name, value)),
      origins: [],
    },
  });
  const made = async (scope: 'read' | 'trade') => {
    const answer = await call(person, 'POST', '/api/v1/me/keys', {
      name: `Done-test ${scope} (run ${runKey()})`.slice(0, 60),
      scope,
    });
    expect(answer.status, `a ${scope} key is made`).toBe(201);
    return { secret: String(answer.body.secret), id: (answer.body.key as { id: string }).id };
  };
  const readKey = await made('read');
  const tradeKey = await made('trade');

  // A bot with the read-only key reads its positions and is refused a trade.
  const reader = await bot(playwright, readKey.secret);
  const held = await call(reader, 'GET', '/api/v1/me/positions');
  expect(held.status, 'a read-only key reads its positions').toBe(200);
  expect(held.body).toEqual({ balance: '1000.000000', positions: [], next: null });
  expect(held.headers.ratelimit, "the RateLimit headers say what's left").toMatch(
    /^"key-reads";r=\d+;t=\d+$/,
  );

  const admin = await playwright.request.newContext({
    baseURL: BASE,
    storageState: adminState('chromium'),
  });
  const marketId = newRecordId();
  const market = await call(admin, 'POST', '/api/v1/admin/markets', {
    id: marketId,
    question: `3.5a done-test (run ${runKey()}): will the test desk record event K?`.slice(0, 120),
    categories: ['general'],
    rules: `A test market of the 3.5a done-test, run ${runKey()}.\nIt settles as the test decides.`,
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    listed: false,
  });
  expect(market.status, 'the console makes the test market').toBe(201);
  expect((await call(admin, 'POST', `/api/v1/admin/markets/${marketId}/open`)).status).toBe(200);
  const buy = () => ({
    marketId,
    requestId: randomUUID(),
    action: 'buy',
    outcome: 'yes',
    amount: '10',
  });
  const refused = await call(reader, 'POST', '/api/v1/trades', buy());
  expect(refused.status, 'a read-only key is refused a trade').toBe(403);

  // With the trading key it trades.
  const trader = await bot(playwright, tradeKey.secret);
  const traded = await call(trader, 'POST', '/api/v1/trades', buy());
  expect(traded.status, 'a trading key trades').toBe(200);
  expect(traded.body).toMatchObject({
    status: 'filled',
    amount: '10.000000',
    balance: '990.000000',
  });

  // Revoked, the trading key is refused within seconds.
  expect((await call(person, 'POST', `/api/v1/me/keys/${tradeKey.id}/revoke`)).status).toBe(200);
  const revokedAt = Date.now();
  const reads = await call(trader, 'GET', '/api/v1/me/positions');
  const trades = await call(trader, 'POST', '/api/v1/trades', buy());
  expect(reads.status, 'a revoked key reads nothing').toBe(401);
  expect(trades.status, 'a revoked key trades nothing').toBe(401);
  expect((Date.now() - revokedAt) / 1000, 'refused within seconds').toBeLessThan(10);
  expect((await call(person, 'POST', `/api/v1/me/keys/${readKey.id}/revoke`)).status).toBe(200);

  await settleAndCheckBooks({
    admin,
    marketId,
    traders: [{ name: 'the bot', as: person, start: micros('1000') }],
    settlement: { outcome: 'yes' },
    evidence: `The 3.5a done-test, run ${runKey()}, settled it Yes.`,
  });
  await Promise.all([anyone, person, reader, trader, admin].map((c) => c.dispose()));
});
