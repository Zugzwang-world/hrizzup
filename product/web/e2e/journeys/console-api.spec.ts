import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { adminState, signedInState } from '../support/states.ts';
import { ADMIN_TEST_ACCOUNT } from '../support/test-accounts.ts';

/**
 * Journey: the market console's calls in the typed API (PLAN.md step 1.7c), over HTTP, as any
 * client calls them, signed in with the sessions global-setup.ts made (the website's own cookies,
 * which the API reads as it reads the app's token), so the journey signs nobody in itself.
 * - To anyone but an admin, signed in or not, and whatever they send, each answers exactly as an
 *   address the API doesn't have; on production, until launch, to everyone.
 * - An admin creates a market, opens, closes and settles it; the log shows each step, and the
 *   settlement's payouts come to exactly what the market held.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** Every call of the console's, with something to send (none of it a valid request). */
const calls = (id: string): [string, string, unknown?][] => [
  ['GET', '/api/v1/admin/markets'],
  ['GET', `/api/v1/admin/markets/${id}`],
  ['POST', '/api/v1/admin/markets', { question: 'Not a market at all' }],
  ['POST', `/api/v1/admin/markets/${id}/open`],
  ['POST', `/api/v1/admin/markets/${id}/close`],
  ['POST', `/api/v1/admin/markets/${id}/settle`, { outcome: 'yes' }],
];

async function call(
  request: APIRequestContext,
  method: string,
  path: string,
  headers: Record<string, string>,
  data?: unknown,
) {
  const response = await request.fetch(path, { method, headers, ...(data ? { data } : {}) });
  const text = await response.text();
  return {
    status: response.status(),
    text,
    body: JSON.parse(text) as Record<string, unknown>,
    caching: response.headers()['cache-control'],
    type: response.headers()['content-type'],
  };
}

test("the console's calls answer anyone but an admin as an address the API doesn't have", async ({
  request,
  playwright,
  baseURL,
  browserName,
}) => {
  const unknown = await call(request, 'GET', '/api/v1/admin/no-such-call', {});
  expect(unknown.status).toBe(404);
  const id = newRecordId();

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
  for (const { who, as } of strangers) {
    for (const [method, path, data] of calls(id)) {
      const answer = await call(as, method, path, {}, data);
      expect(answer.status, `${who}: ${method} ${path}`).toBe(404);
      // Byte for byte the same as an address the API doesn't have.
      expect(answer.text, `${who}: ${method} ${path}`).toBe(unknown.text);
      expect(answer.type, `${who}: ${method} ${path}`).toBe(unknown.type);
      expect(answer.caching, `${who}: ${method} ${path}`).toBe('private, no-store');
    }
  }
});

test('an admin creates, opens, closes and settles a market; the log shows it, and the payouts add up', async ({
  playwright,
  baseURL,
  browserName,
}) => {
  test.skip(environment() === 'production', "The console doesn't exist on production until launch");
  const request = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: adminState(browserName),
  });
  const headers = {};
  const id = newRecordId();
  const market = {
    id,
    question: `Journey test ${id.slice(-6)}: will the test desk record event A?`,
    categories: ['general'],
    rules: 'A test market for the console journey.\nYes wins if the test desk records event A.',
    source: { name: "Hrizzup's test desk (a placeholder source)" },
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  const created = await call(request, 'POST', '/api/v1/admin/markets', headers, market);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ id, state: 'draft', held: '0.000000' });
  expect(created.caching).toBe('private, no-store');
  // A retried create gets back the same market; the same ID for another question is refused.
  const again = await call(request, 'POST', '/api/v1/admin/markets', headers, market);
  expect(again.body).toMatchObject({ id, state: 'draft' });
  const reused = await call(request, 'POST', '/api/v1/admin/markets', headers, {
    ...market,
    question: 'A different question for the same ID?',
  });
  expect(reused.status).toBe(400);

  const opened = await call(request, 'POST', `/api/v1/admin/markets/${id}/open`, headers);
  expect(opened.body).toMatchObject({ state: 'open', held: '1000.000000' });
  const closed = await call(request, 'POST', `/api/v1/admin/markets/${id}/close`, headers);
  expect(closed.body).toMatchObject({ state: 'closed' });
  const held = String(closed.body.held);

  const settled = await call(request, 'POST', `/api/v1/admin/markets/${id}/settle`, headers, {
    outcome: 'yes',
    evidence: 'The test desk recorded event A (the console journey).',
  });
  expect(settled.status).toBe(200);
  expect(settled.body).toMatchObject({
    state: 'settled',
    held: '0.000000',
    result: { outcome: 'yes' },
  });
  const log = settled.body.log as {
    action: string;
    by: { email: string };
    settlement: Record<string, string> | null;
  }[];
  expect(log.map((line) => line.action)).toEqual(['create', 'open', 'close', 'settle']);
  expect(log.every((line) => line.by.email === ADMIN_TEST_ACCOUNT)).toBe(true);
  const sums = log.at(-1)?.settlement ?? {};
  expect(sums.evidence).toBe('The test desk recorded event A (the console journey).');
  // To people and to the house, exactly what the market held (no bets: the seed, back home).
  expect(Number(sums.paidToPeople) + Number(sums.toHouse)).toBe(Number(held));

  const twice = await call(request, 'POST', `/api/v1/admin/markets/${id}/settle`, headers, {
    outcome: 'no',
    evidence: 'Again.',
  });
  expect(twice.status).toBe(409);
  const listed = await call(request, 'GET', '/api/v1/admin/markets', headers);
  expect((listed.body.markets as { id: string }[]).some((m) => m.id === id)).toBe(true);
  await request.dispose();
});
