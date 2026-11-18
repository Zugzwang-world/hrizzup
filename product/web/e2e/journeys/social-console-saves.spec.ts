import { type APIRequestContext, expect, test } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { runKey } from '../support/run.ts';
import { adminState, signedInState } from '../support/states.ts';

/**
 * Journey: the social console's three live calls (docs/social/build.md, D4, D13, sections 7.9 and
 * 7.10), over HTTP as any client calls them, signed in with the sessions global-setup.ts made, so the
 * journey signs nobody in itself.
 * - To anyone but an admin, signed in or not, and whatever they send, each answers exactly as an
 *   address the API doesn't have.
 * - An admin saves an unlisted test story and an update of it, and makes an invite for a fake
 *   `.test` address, each through the console's own call; the same story again is `same`, a newer
 *   version is `changed`, an older one and a changed listing are refused; a retried invite answers a
 *   fresh code for the same invite; a rule of the content store that the database raises when the
 *   transaction commits comes back as a 400 issue.
 * Every record carries the run's own ID and key (support/run.ts), the story is unlisted so it stays off
 * the board, and the invite is unlisted too and for an address no one reads. Nothing here reads a key
 * of the app's: the sessions come from global-setup.ts.
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

/** Headers that differ from one answer to the next by their nature (the time, the request's ID). */
const PER_ANSWER = new Set([
  'date',
  'age',
  'x-vercel-id',
  'x-vercel-cache',
  'connection',
  'keep-alive',
]);

type Answer = {
  status: number;
  text: string;
  body: Record<string, unknown>;
  caching: string | undefined;
  headers: Record<string, string>;
};

async function call(
  request: APIRequestContext,
  method: string,
  path: string,
  data?: unknown,
): Promise<Answer> {
  const response = await request.fetch(path, { method, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON: the text is what is compared.
  }
  return {
    status: response.status(),
    text,
    body,
    caching: response.headers()['cache-control'],
    headers: Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => !PER_ANSWER.has(name)),
    ),
  };
}

/** A story/1 record of the run's: an unlisted test story, made now. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Journey test (${label}): a test story of the social console`,
    summary: `A test story of a check run (${label}), made by the social console's journey on staging. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of the story, reported now. */
function updateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Journey test (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/social-console-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

const CODE = /^hz-[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/;

test("the console's three saves answer anyone but an admin as an address the API doesn't have", async ({
  request,
  playwright,
  baseURL,
  browserName,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  // Staging's firewall lets only browsers write to its typed API (journeys/console-api.spec.ts says
  // why); previews, where the checks run, have no such rule.
  test.skip(environment() === 'staging', 'These are writes: see console-api.spec.ts');
  const unknown = await call(request, 'GET', '/api/v1/no-such-call');
  expect(unknown.status).toBe(404);

  const id = newRecordId();
  const label = `run ${runKey()}, ${browserName}`;
  const sends: [string, string, unknown][] = [
    [
      'POST',
      '/api/v1/admin/social/stories',
      { record: storyRecord(id, label, new Date(Date.now() - 60_000)), listed: false },
    ],
    [
      'POST',
      '/api/v1/admin/social/updates',
      { record: updateRecord(newRecordId(), id, label, new Date(Date.now() - 60_000)) },
    ],
    [
      'POST',
      '/api/v1/admin/social/invites',
      {
        requestId: crypto.randomUUID(),
        email: `strangers-${runKey()}@journey.test`,
        listed: false,
      },
    ],
    ['POST', '/api/v1/admin/social/stories', {}],
    ['POST', '/api/v1/admin/social/invites', {}],
  ];
  // The signed-in stranger's context is this test's own (the `request` fixture is Playwright's), so it is
  // disposed whatever the loop finds.
  const signedInStranger = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: signedInState(browserName),
  });
  const strangers: { who: string; as: APIRequestContext }[] = [
    { who: 'signed out', as: request },
    { who: 'signed in, not an admin', as: signedInStranger },
  ];
  try {
    for (const { who, as } of strangers) {
      for (const [method, path, data] of sends) {
        const answer = await call(as, method, path, data);
        const what = `${who}: ${method} ${path}`;
        expect(answer.status, what).toBe(404);
        // Byte for byte the same as an address the API doesn't have, and the same headers.
        expect(answer.text, what).toBe(unknown.text);
        expect(answer.headers, what).toEqual(unknown.headers);
        expect(answer.caching, what).toBe('private, no-store');
      }
    }
  } finally {
    await signedInStranger.dispose();
  }
});

test('an admin saves an unlisted test story and an update, and makes an invite: each through its own call, safe to retry', async ({
  playwright,
  baseURL,
  browserName,
}) => {
  test.skip(environment() === 'production', "Social doesn't exist on production until launch");
  test.skip(environment() === 'staging', 'These are writes: see console-api.spec.ts');
  const request = await playwright.request.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: adminState(browserName),
  });
  const label = `run ${runKey()}, ${browserName}`;
  const storyId = newRecordId();
  // Every record's time is a minute in the past, so no time is ahead of the database's clock whatever the
  // runner's own is (the later versions below add a second or two to it).
  const started = new Date(Date.now() - 60_000);
  const story = storyRecord(storyId, label, started);

  // The test story: new, listed or not as chosen once, never kept by anyone.
  const made = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: story,
    listed: false,
  });
  expect(made.status).toBe(200);
  expect(made.body).toMatchObject({
    id: storyId,
    title: story.title,
    listed: false,
    madeBy: 'console',
    state: 'live',
    saved: 'new',
    categories: ['general'],
    places: ['mumbai'],
  });
  expect(made.caching).toBe('private, no-store');

  // The very same story again is `same`; a later version is `changed`; an older one, and another
  // choice of `listed`, are refused.
  const same = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: story,
    listed: false,
  });
  expect(same.body).toMatchObject({ id: storyId, saved: 'same', listed: false });
  const later = {
    ...story,
    title: `${story.title} (rewritten)`,
    updated_at: new Date(started.getTime() + 1_000).toISOString(),
  };
  const changed = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: later,
    listed: false,
  });
  expect(changed.body).toMatchObject({ id: storyId, saved: 'changed', title: later.title });
  const older = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: { ...story, title: `${story.title} (older)` },
    listed: false,
  });
  expect(older.status).toBe(409);
  expect(older.body).toMatchObject({ code: 'CONFLICT', data: { reason: 'stale_record' } });
  const relisted = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: later,
    listed: true,
  });
  expect(relisted.status).toBe(409);
  expect(relisted.body).toMatchObject({ data: { reason: 'listing_fixed' } });
  // Whatever a refusal says, it never speaks of a market.
  expect(String(relisted.body.message)).not.toMatch(/market/i);

  // A story the agreement refuses: each problem is a 400 issue, under `record`.
  const bad = await call(request, 'POST', '/api/v1/admin/social/stories', {
    record: {
      ...story,
      id: newRecordId(),
      title: ` ${story.title}`,
      categories: ['general', 'general'],
    },
    listed: false,
  });
  expect(bad.status).toBe(400);
  const paths = (bad.body.data as { issues: { path: string }[] }).issues.map((issue) => issue.path);
  expect(paths).toEqual(expect.arrayContaining(['record.title', 'record.categories']));

  // Its update: new, then the same.
  const updateId = newRecordId();
  const update = updateRecord(updateId, storyId, label, new Date(started.getTime() + 2_000));
  const updated = await call(request, 'POST', '/api/v1/admin/social/updates', { record: update });
  expect(updated.status).toBe(200);
  expect(updated.body).toEqual({ id: updateId, storyId, saved: 'new' });
  const again = await call(request, 'POST', '/api/v1/admin/social/updates', { record: update });
  expect(again.body).toMatchObject({ id: updateId, saved: 'same' });
  // An update of a story that doesn't exist: the content store's rule across records, which the
  // database raises when the transaction commits, comes back as a 400 issue on the story's ID.
  const orphan = await call(request, 'POST', '/api/v1/admin/social/updates', {
    record: updateRecord(newRecordId(), newRecordId(), label, new Date(Date.now() - 60_000)),
  });
  expect(orphan.status).toBe(400);
  expect(orphan.body).toMatchObject({
    code: 'BAD_REQUEST',
    data: { issues: [{ path: 'record.story_id' }] },
  });

  // An invite for an address nobody reads: its code (shown once) and the message to send, unlisted.
  const email = `social-console-${runKey()}-${browserName}-${storyId.slice(-6)}@journey.test`;
  const invite = {
    requestId: crypto.randomUUID(),
    email,
    note: `The social console's journey (${label})`,
    house: false,
    listed: false,
  };
  const created = await call(request, 'POST', '/api/v1/admin/social/invites', invite);
  expect(created.status).toBe(201);
  const first = created.body as { invite: Record<string, unknown>; code: string; message: string };
  expect(first.code).toMatch(CODE);
  expect(first.invite).toMatchObject({
    email,
    listed: false,
    house: false,
    codeShown: first.code.slice(0, 7),
    usedAt: null,
    revokedAt: null,
    agent: null,
  });
  expect(first.message).toContain(first.code);
  expect(first.message).toContain(email);
  expect(first.message).toContain('/skill.md');
  expect(created.caching).toBe('private, no-store');
  // A retry of the same request reaches the same invite and answers a fresh code (the first, which
  // nobody saw, is replaced); another request for the same address finds an invite already open.
  const retried = await call(request, 'POST', '/api/v1/admin/social/invites', invite);
  expect(retried.status).toBe(201);
  const second = retried.body as { invite: { id: string }; code: string };
  expect(second.invite.id).toBe((first.invite as { id: string }).id);
  expect(second.code).toMatch(CODE);
  expect(second.code).not.toBe(first.code);
  const open = await call(request, 'POST', '/api/v1/admin/social/invites', {
    ...invite,
    requestId: crypto.randomUUID(),
  });
  expect(open.status).toBe(409);
  expect(open.body).toMatchObject({ data: { reason: 'invite_open' } });
  const reused = await call(request, 'POST', '/api/v1/admin/social/invites', {
    ...invite,
    note: 'A different note for the same request',
  });
  expect(reused.status).toBe(409);
  expect(reused.body).toMatchObject({ data: { reason: 'request_reused' } });
  await request.dispose();
});
