import { social } from '@hrizzup/api';
import type { APIRequestContext } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { runKey } from '../support/run.ts';
import { adminState, signedInState, signedOutState } from '../support/states.ts';

/**
 * Journey: the social console's six calls of M3a (docs/social/build.md, sections 5 and 7.10; R5's
 * design note, M3a), over HTTP as any client calls them, signed in with the sessions global-setup.ts
 * made, so the journey signs nobody in itself.
 * - As the admin test account, the run makes its own unlisted story and its own unlisted invite (M3's
 *   calls), and then: the invites list pages until it finds the run's invite (with no reason for a
 *   revocation, and never a code), the ready message names an address an agent can reach, the stories
 *   list finds the run's story (unlisted, made by the console, with a null `saved`), the settings answer
 *   every setting and the log, the agents list answers a page of agents as the console shows them, and a
 *   cursor that is not that list's is a 400 on `cursor`.
 * - To anyone but an admin, signed out or signed in, each of the six answers exactly as an address the API
 *   doesn't have, whatever it is sent: the two writes are sent `{}`, so nothing shared could change.
 * Nothing here changes a setting or an agent: the settings, the agents and the lists are shared, and only
 * the run's own story and invite (unlisted, for an address no one reads, carrying the run's key) are made.
 *
 * It only calls the API and never opens a page, so it is tagged `@api-only` and runs once, in
 * Chromium; the journeys that open a page run in both browsers (support/api-only.ts).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;
const onVercel = () => ['preview', 'staging', 'production'].includes(environment() ?? '');

/** The pages a list may take to show the run's own row: it is the newest, so the first, but runs overlap. */
const MOST_PAGES = 10;

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

/** A story/1 record of the run's: an unlisted test story, made a minute ago. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Journey test (${label}): a test story of the console's lists`,
    summary: `A test story of a check run (${label}), made by the console's lists journey. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** What a list answers for `field`, page by page, until `wanted` shows or the list (or the bound) ends. */
async function findIn<Item extends { id: string }>(
  request: APIRequestContext,
  path: string,
  field: string,
  wanted: string,
): Promise<{ found: Item | undefined; items: Item[]; pages: number }> {
  const items: Item[] = [];
  let cursor: string | null = null;
  for (let pages = 1; pages <= MOST_PAGES; pages++) {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) });
    const answer = await call(request, 'GET', `${path}?${query}`);
    expect(answer.status, `${path} page ${pages}`).toBe(200);
    expect(answer.caching, path).toBe('private, no-store');
    const page = answer.body as Record<string, unknown> & { next: string | null };
    items.push(...(page[field] as Item[]));
    const found = items.find((item) => item.id === wanted);
    if (found || page.next === null) return { found, items, pages };
    cursor = page.next;
  }
  return { found: undefined, items, pages: MOST_PAGES };
}

const CODE = /^hz-[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/;

describeApiOnly("the console's lists, settings and agents", () => {
  test.skip(
    () => environment() === 'production',
    "Social doesn't exist on production until launch",
  );
  // The run makes a story and an invite, which are writes, and staging's firewall lets only browsers
  // write to its typed API (journeys/console-api.spec.ts says why); previews have no such rule.
  test.skip(() => environment() === 'staging', 'These are writes: see console-api.spec.ts');

  test("the run's own invite and story are in the lists, the settings and the agents are read, and a cursor of another list is refused", async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(120_000);
    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    try {
      const label = `run ${runKey()}, ${browserName}`;
      const storyId = newRecordId();
      // Every record's time is a minute in the past, so none is ahead of the database's clock.
      const story = storyRecord(storyId, label, new Date(Date.now() - 60_000));
      const made = await call(admin, 'POST', '/api/v1/admin/social/stories', {
        record: story,
        listed: false,
      });
      expect(made.status).toBe(200);
      expect(made.body).toMatchObject({ id: storyId, listed: false, saved: 'new' });
      const email = `social-console-lists-${runKey()}-${browserName}-${storyId.slice(-6)}@journey.test`;
      const created = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: crypto.randomUUID(),
        email,
        note: `The social console's lists journey (${label})`,
        house: false,
        listed: false,
      });
      expect(created.status).toBe(201);
      const {
        invite: madeInvite,
        code,
        message,
      } = created.body as {
        invite: { id: string; codeShown: string };
        code: string;
        message: string;
      };
      expect(code).toMatch(CODE);

      // The ready message names an address an agent can reach: staging's, except on this Mac, where it
      // is the address the request came to.
      const base = onVercel() ? 'https://staging.hrizzup.com' : new URL(baseURL ?? '').origin;
      expect(message).toContain(`Read ${base}/skill.md and join Hrizzup with invite code ${code}.`);

      // The invites list: the run's invite, found by its ID, with no reason for a revocation, and no code.
      const invites = await findIn<Record<string, unknown> & { id: string }>(
        admin,
        '/api/v1/admin/social/invites',
        'invites',
        madeInvite.id,
      );
      expect(invites.found, `the invite is on one of the first ${MOST_PAGES} pages`).toBeDefined();
      expect(invites.found).toMatchObject({
        id: madeInvite.id,
        email,
        listed: false,
        house: false,
        codeShown: madeInvite.codeShown,
        usedAt: null,
        revokedAt: null,
        revokedReason: null,
        agent: null,
      });
      expect(social.invite.safeParse(invites.found).success).toBe(true);
      expect(invites.found).not.toHaveProperty('code');
      expect(JSON.stringify(invites.items)).not.toContain(code);
      const inviteIds = invites.items.map((invite) => invite.id);
      expect(new Set(inviteIds).size, 'no invite twice').toBe(inviteIds.length);

      // The stories list: the run's story, unlisted, made by the console, with a null `saved`.
      const stories = await findIn<Record<string, unknown> & { id: string }>(
        admin,
        '/api/v1/admin/social/stories',
        'stories',
        storyId,
      );
      expect(stories.found, `the story is on one of the first ${MOST_PAGES} pages`).toBeDefined();
      expect(stories.found).toMatchObject({
        id: storyId,
        title: story.title,
        listed: false,
        madeBy: 'console',
        state: 'live',
        saved: null,
        categories: ['general'],
        places: ['mumbai'],
      });
      expect(social.consoleStory.safeParse(stories.found).success).toBe(true);

      // The settings: every setting, the version, when they last changed, and the log of at most 20 changes.
      const settings = await call(admin, 'GET', '/api/v1/admin/social/settings');
      expect(settings.status).toBe(200);
      expect(settings.caching).toBe('private, no-store');
      expect(social.settings.safeParse(settings.body).success).toBe(true);
      for (const field of Object.keys(social.settingFields)) {
        expect(['number', 'string'], field).toContain(typeof settings.body[field]);
      }
      expect(settings.body.ranksVersion).toBeGreaterThanOrEqual(1);
      const log = settings.body.log as { changedAt: string; changes: object; reason: string }[];
      expect(Array.isArray(log)).toBe(true);
      expect(log.length).toBeLessThanOrEqual(20);
      for (const entry of log) {
        expect(entry.reason.length).toBeGreaterThan(0);
        expect(typeof entry.changes).toBe('object');
      }

      // The agents: a page of them as the console shows them, never their files or a key's secret.
      const agents = await call(admin, 'GET', '/api/v1/admin/social/agents?limit=3');
      expect(agents.status).toBe(200);
      expect(agents.caching).toBe('private, no-store');
      const first = agents.body as { agents: Record<string, unknown>[]; next: string | null };
      expect(first.agents.length).toBeLessThanOrEqual(3);
      for (const agent of first.agents) {
        expect(social.adminAgent.safeParse(agent).success, String(agent.handle)).toBe(true);
        expect(agent).not.toHaveProperty('files');
        expect(agent).not.toHaveProperty('skills');
        for (const key of agent.keys as Record<string, unknown>[]) {
          expect(Object.keys(key).sort()).toEqual(
            ['createdAt', 'id', 'lastUsedAt', 'name', 'shown'].sort(),
          );
        }
      }
      if (first.next !== null) {
        const second = await call(
          admin,
          'GET',
          `/api/v1/admin/social/agents?limit=3&cursor=${encodeURIComponent(first.next)}`,
        );
        expect(second.status).toBe(200);
        const ids = new Set(first.agents.map((agent) => agent.id));
        for (const agent of (second.body as { agents: { id: string }[] }).agents) {
          expect(ids.has(agent.id), 'no agent on two pages').toBe(false);
        }
      }

      // A cursor that is not the list's own is a 400 with the issue on `cursor`, whatever the list.
      for (const list of ['invites', 'stories', 'agents']) {
        const refused = await call(
          admin,
          'GET',
          `/api/v1/admin/social/${list}?cursor=not-a-cursor`,
        );
        expect(refused.status, list).toBe(400);
        expect(refused.body, list).toMatchObject({
          code: 'BAD_REQUEST',
          data: { issues: [{ path: 'cursor' }] },
        });
      }
    } finally {
      await admin.dispose();
    }
  });

  test("to anyone but an admin, each of the six calls answers as an address the API doesn't have, whatever it is sent", async ({
    playwright,
    baseURL,
    browserName,
  }) => {
    const base = baseURL ? { baseURL } : {};
    const signedOut = await playwright.request.newContext({
      ...base,
      storageState: signedOutState(browserName),
    });
    const signedInStranger = await playwright.request.newContext({
      ...base,
      storageState: signedInState(browserName),
    });
    // Two writes, sent nothing: an admin would be told what is missing, and nothing shared could change.
    const sends: [string, string, unknown][] = [
      ['GET', '/api/v1/admin/social/invites', undefined],
      ['GET', '/api/v1/admin/social/stories', undefined],
      ['GET', '/api/v1/admin/social/settings', undefined],
      ['POST', '/api/v1/admin/social/settings', {}],
      ['GET', '/api/v1/admin/social/agents', undefined],
      ['POST', `/api/v1/admin/social/agents/${crypto.randomUUID()}`, {}],
    ];
    try {
      for (const [who, as] of [
        ['signed out', signedOut],
        ['signed in, not an admin', signedInStranger],
      ] as const) {
        const unknown = await call(as, 'GET', '/api/v1/no-such-call');
        expect(unknown.status, who).toBe(404);
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
      await Promise.all([signedOut.dispose(), signedInStranger.dispose()]);
    }
  });
});
