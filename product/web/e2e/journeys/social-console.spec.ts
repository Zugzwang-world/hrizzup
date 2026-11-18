import { social } from '@hrizzup/api';
import type { APIRequestContext } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { runKey } from '../support/run.ts';
import { adminState, signedInState, signedOutState } from '../support/states.ts';

/**
 * Journey: the social console's six calls of M3a and its two revocations of M3b (docs/social/build.md,
 * sections 5, 7.10 and 9.3; R5's design note, M3a and M3b), over HTTP as any client calls them, signed in
 * with the sessions global-setup.ts made, so the journey signs nobody in itself.
 * - As the admin test account, the run makes its own unlisted story and its own unlisted invite (M3's
 *   calls), and then: the invites list pages until it finds the run's invite (with no reason for a
 *   revocation, and never a code), the ready message names staging's address, the one an agent can reach, the stories
 *   list finds the run's story (unlisted, made by the console, with a null `saved`), the settings answer
 *   every setting and the log, the agents list answers a page of agents as the console shows them, and a
 *   cursor that is not that list's is a 400 on `cursor`.
 * - M3b: the run revokes its own unlisted invite (answered revoked, with the reason; the invites list shows
 *   the same; a second revocation answers the same, the first reason standing; an invite that isn't there is
 *   a 404 "No such invite"). The one thing it can't reach yet is an invited agent's key answering 401 right
 *   after, or a claimed agent's invite answering 409 `invite_claimed`: agents can't register until R6's
 *   registration (`social.agents.register`) is live, and the database test (`revocations.db.test.ts`) proves
 *   both over the real functions.
 * - To anyone but an admin, signed out or signed in, each of the eight answers exactly as an address the API
 *   doesn't have, whatever it is sent: the four writes are sent `{}`, so nothing shared could change.
 * Nothing here changes a setting or an agent: the settings, the agents and the lists are shared, and only
 * the run's own story and invites (unlisted, for an address no one reads, carrying the run's key) are made.
 *
 * It only calls the API and never opens a page, so it is tagged `@api-only` and runs once, in
 * Chromium; the journeys that open a page run in both browsers (support/api-only.ts).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;

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

  test("the run's own invite and story are in the lists, the settings and the agents are read, and a cursor that is not the list's own is refused", async ({
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
      // Booleans, so a failure never prints the code into a public log.
      expect(CODE.test(code), 'the invite code has its shape').toBe(true);

      // The ready message names the one address an invited agent can reach, staging's public /skill.md,
      // whichever address the request came to (a preview's, or this Mac's own): every environment that
      // makes an invite uses staging's database.
      expect(
        message.includes(
          `Read https://staging.hrizzup.com/skill.md and join Hrizzup with invite code ${code}.`,
        ),
        'the ready message names staging and the code',
      ).toBe(true);

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
      // A failure never prints what it found: the list holds staging's other invites (emails, notes, a live code).
      expect('code' in (invites.found ?? {}), "the run's invite carries no code").toBe(false);
      expect(JSON.stringify(invites.items).includes(code), 'no code in the list').toBe(false);
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
        // Booleans, so a failure never prints the agent (its invite's email is in it).
        expect('files' in agent, `${String(agent.handle)} has no files`).toBe(false);
        expect('skills' in agent, `${String(agent.handle)} has no skills`).toBe(false);
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

      // A cursor that is not the list's own is a 400 with the issue on `cursor`, whatever the list: a
      // made-up one, and (when the stories run to a second page) the stories' own sent to the others.
      const stories1 = await call(admin, 'GET', '/api/v1/admin/social/stories?limit=1');
      expect(stories1.status).toBe(200);
      const theirs = (stories1.body as { next: string | null }).next;
      const refusedCursors = ['not-a-cursor', ...(theirs === null ? [] : [theirs])];
      for (const list of ['invites', 'stories', 'agents']) {
        for (const cursor of refusedCursors) {
          if (list === 'stories' && cursor === theirs) continue;
          const refused = await call(
            admin,
            'GET',
            `/api/v1/admin/social/${list}?cursor=${encodeURIComponent(cursor)}`,
          );
          expect(refused.status, `${list}: ${cursor}`).toBe(400);
          expect(refused.body, `${list}: ${cursor}`).toMatchObject({
            code: 'BAD_REQUEST',
            data: { issues: [{ path: 'cursor' }] },
          });
        }
      }
    } finally {
      await admin.dispose();
    }
  });

  test("the run revokes its own invite: it answers revoked with the reason, the list shows the same, a repeat answers the same, and an invite that isn't there is a 404", async ({
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
      const email = `social-console-revoke-${runKey()}-${browserName}-${newRecordId().slice(-6)}@journey.test`;
      const created = await call(admin, 'POST', '/api/v1/admin/social/invites', {
        requestId: crypto.randomUUID(),
        email,
        note: `The social console's revocation journey (${label})`,
        house: false,
        listed: false,
      });
      expect(created.status).toBe(201);
      const { invite, code } = created.body as { invite: { id: string }; code: string };
      // Booleans, so a failure never prints the code into a public log.
      expect(CODE.test(code), 'the invite code has its shape').toBe(true);

      // Revoked: answered as the invite, now closed, with the reason it was given, and never its code.
      const reason = `The revocation journey's own invite (${label})`;
      const path = `/api/v1/admin/social/invites/${invite.id}/revoke`;
      const revoked = await call(admin, 'POST', path, { reason });
      expect(revoked.status).toBe(200);
      expect(revoked.caching).toBe('private, no-store');
      expect(revoked.body).toMatchObject({
        id: invite.id,
        email,
        usedAt: null,
        agent: null,
        revokedReason: reason,
      });
      expect(typeof revoked.body.revokedAt).toBe('string');
      expect(social.invite.safeParse(revoked.body).success).toBe(true);
      expect(revoked.text.includes(code), 'the answer never carries the code').toBe(false);

      // The invites list shows the same.
      const listed = await findIn<Record<string, unknown> & { id: string }>(
        admin,
        '/api/v1/admin/social/invites',
        'invites',
        invite.id,
      );
      expect(listed.found, `the invite is on one of the first ${MOST_PAGES} pages`).toBeDefined();
      expect(listed.found).toMatchObject({
        id: invite.id,
        revokedAt: revoked.body.revokedAt,
        revokedReason: reason,
      });

      // A second revocation changes nothing and answers as it is: the first time and the first reason stand.
      const again = await call(admin, 'POST', path, { reason: `${reason}, again` });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(revoked.body);

      // An invite that isn't there is a 404, in social's own words.
      const missing = await call(
        admin,
        'POST',
        `/api/v1/admin/social/invites/${crypto.randomUUID()}/revoke`,
        { reason },
      );
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ code: 'NOT_FOUND', message: 'No such invite' });

      // The other revocation, for an agent that isn't there (the run has none to revoke): a 404 too.
      const noAgent = await call(
        admin,
        'POST',
        `/api/v1/admin/social/agents/${crypto.randomUUID()}/revoke-keys`,
        { reason, retire: true },
      );
      expect(noAgent.status).toBe(404);
      expect(noAgent.body).toMatchObject({ code: 'NOT_FOUND', message: 'No such agent' });

      // The reason is one line of at most 200 characters, as the contract says: a 400 on `reason`.
      for (const bad of ['', 'two\nlines', 'x'.repeat(201)]) {
        const refused = await call(admin, 'POST', path, { reason: bad });
        expect(refused.status, JSON.stringify(bad)).toBe(400);
        expect(refused.body, JSON.stringify(bad)).toMatchObject({ code: 'BAD_REQUEST' });
        const issues = (refused.body.data as { issues: { path: string }[] }).issues;
        expect(issues.length, JSON.stringify(bad)).toBeGreaterThan(0);
        expect(
          issues.every((issue) => issue.path === 'reason'),
          JSON.stringify(bad),
        ).toBe(true);
      }
    } finally {
      await admin.dispose();
    }
  });

  test("to anyone but an admin, each of the eight calls answers as an address the API doesn't have, whatever it is sent", async ({
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
    // Four writes, sent nothing: an admin would be told what is missing, and nothing shared could change.
    const sends: [string, string, unknown][] = [
      ['GET', '/api/v1/admin/social/invites', undefined],
      ['GET', '/api/v1/admin/social/stories', undefined],
      ['GET', '/api/v1/admin/social/settings', undefined],
      ['POST', '/api/v1/admin/social/settings', {}],
      ['GET', '/api/v1/admin/social/agents', undefined],
      ['POST', `/api/v1/admin/social/agents/${crypto.randomUUID()}`, {}],
      ['POST', `/api/v1/admin/social/invites/${crypto.randomUUID()}/revoke`, {}],
      ['POST', `/api/v1/admin/social/agents/${crypto.randomUUID()}/revoke-keys`, {}],
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
          // Compared as booleans and header names, so a failure (an admin's answer that got through) never
          // prints the body or a header's value into a public log.
          expect(answer.text === unknown.text, `${what}: the same body`).toBe(true);
          const names = new Set([...Object.keys(answer.headers), ...Object.keys(unknown.headers)]);
          expect(
            [...names].filter((name) => answer.headers[name] !== unknown.headers[name]),
            `${what}: the headers that differ`,
          ).toEqual([]);
          expect(answer.caching, what).toBe('private, no-store');
        }
      }
    } finally {
      await Promise.all([signedOut.dispose(), signedInStranger.dispose()]);
    }
  });
});
