import { social } from '@hrizzup/api';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { APIRequestContext } from '@playwright/test';
import { newRecordId } from '../../lib/record-id.ts';
import { describeApiOnly, expect, test } from '../support/api-only.ts';
import { fetchThrough } from '../support/quiet-request.ts';
import { runKey } from '../support/run.ts';
import { answerOf, jsonOf } from '../support/social-calls.ts';
import { adminState, signedOutState } from '../support/states.ts';

/**
 * Journey: the board's and the stories' six public reads (docs/social/build.md, sections 5 and 6; R5's
 * design note, M1), over HTTP as any client calls them, and the purge of a console save.
 * - The run's own unlisted test story and two updates are saved through the console's calls (the admin
 *   test account, as `social-console-saves.spec.ts` does); the lists; the board, which never holds the
 *   run's story; the story with its updates newest first; its updates paged one at a time with `next`;
 *   its desk, empty; its brief, holding its title and both updates, with the same version twice; a
 *   made-up ID answering 404 on every read.
 * - Then the purge, end to end: the story is read until the edge keeps it, a third update is saved
 *   through the console, and the story read is polled until it shows the update, well under the edge's
 *   own minute, so only the console save's purge can have made it fresh (and the same for the brief,
 *   whose Redis copy the save deletes). The poll proves the purge, not the edge's own expiry: the old
 *   copy's age, when the update shows, is under the minute it is kept for. Where the address is not
 *   Vercel's (this Mac), nothing is kept at the edge, and the freshness is still asserted.
 * - The same six reads are MCP tools (beta, public, no key), and the story tool answers the story.
 * Every record carries the run's own ID and key (support/run.ts), the story is unlisted so it stays off
 * the board, and nothing here lists a story or writes a setting: the settings and the board are shared.
 *
 * It only calls the API and never opens a page, so it is tagged `@api-only` and runs once, in
 * Chromium; the journeys that open a page run in both browsers (support/api-only.ts).
 */

const environment = () => process.env.SCREEN_CHECK_ENVIRONMENT;
const onVercel = () => ['preview', 'staging', 'production'].includes(environment() ?? '');

/** How long a console save may take to show on a read the edge had kept: far under the edge's own minute. */
const PURGE_DEADLINE_MS = 40_000;
/** How long the edge keeps a story read fresh (the contract's `edgeSeconds`). */
const EDGE_SECONDS = 60;

type Answer = {
  status: number;
  body: Record<string, unknown>;
  caching: string | undefined;
  edge: string | undefined;
  /** Seconds the edge's copy had been kept (Vercel's `Age`), when it answered from one. */
  age: number;
};

async function get(request: APIRequestContext, path: string): Promise<Answer> {
  const { status, text, headers } = await answerOf('GET', path, () => request.get(path));
  return {
    status,
    body: jsonOf(text),
    caching: headers['cache-control'],
    edge: headers['x-vercel-cache'],
    age: Number(headers.age ?? '0'),
  };
}

async function save(request: APIRequestContext, path: string, data: unknown): Promise<Answer> {
  const { status, text, headers } = await answerOf('POST', path, () =>
    request.post(path, { data }),
  );
  return { status, body: jsonOf(text), caching: headers['cache-control'], edge: undefined, age: 0 };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads an address until Vercel's edge serves a copy of it, and says how old that copy was and when it
 * was served: only a purge can show a later save before that copy's own minute is up. Where there is no
 * edge (this Mac), nothing is read and nothing is kept.
 */
async function prime(
  request: APIRequestContext,
  path: string,
): Promise<{ age: number; at: number }> {
  let primed = { age: 0, at: Date.now() };
  if (!onVercel()) return primed;
  let kept = false;
  for (let attempt = 0; attempt < 20 && !kept; attempt++) {
    if (attempt > 0) await sleep(500);
    const again = await get(request, path);
    expect(again.status, path).toBe(200);
    kept = again.edge === 'HIT';
    primed = { age: again.age, at: Date.now() };
  }
  expect(kept, `the edge keeps ${path} within seconds`).toBe(true);
  return primed;
}

/**
 * Reads an address every second, until `done` says what it answered is the new one or `deadline` (a
 * moment, in milliseconds) passes: the first read after a purge may be the old copy, served once while the
 * edge fetches the new one. Answers the last thing read and the moment it was read.
 */
async function until<T>(
  deadline: number,
  read: () => Promise<T>,
  done: (answer: T) => boolean,
): Promise<{ answer: T; at: number }> {
  for (;;) {
    const answer = await read();
    const at = Date.now();
    if (done(answer) || at >= deadline) return { answer, at };
    await sleep(1000);
  }
}

/** A story/1 record of the run's: an unlisted test story, made a minute ago. */
function storyRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Journey test (${label}): a test story of the board`,
    summary: `A test story of a check run (${label}), made by the board's journey. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of the story, reported at `at`. */
function updateRecord(id: string, storyId: string, headline: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline,
    reported_at: now,
    sources: ['https://example.com/sources/social-board-journey'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

describeApiOnly("the board's and the stories' reads", () => {
  test.skip(
    () => environment() === 'production',
    "Social doesn't exist on production until launch",
  );
  // The saves are writes, which staging's firewall lets only browsers make (journeys/console-api.spec.ts
  // says why); previews, where the checks run, have no such rule.
  test.skip(() => environment() === 'staging', 'These are writes: see console-api.spec.ts');

  test("the run's own story and updates are read through all six calls, and a console save shows at once on what the edge had kept", async ({
    playwright,
    request,
    baseURL,
    browserName,
  }) => {
    test.setTimeout(240_000);
    const admin = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: adminState(browserName),
    });
    // Signed out, for the MCP client (Vercel's bypass cookie on a preview, and nothing else).
    const anyone = await playwright.request.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: signedOutState(browserName),
    });
    const clients: Client[] = [];
    try {
      const label = `run ${runKey()}, ${browserName}`;
      const storyId = newRecordId();
      // Every record's time is a minute in the past, so none is ahead of the database's clock whatever the
      // runner's own is (the updates add a few seconds to it).
      const started = new Date(Date.now() - 60_000);
      const at = (seconds: number) => new Date(started.getTime() + seconds * 1000);
      const story = storyRecord(storyId, label, started);
      const firstUpdate = updateRecord(
        newRecordId(),
        storyId,
        `Journey test (${label}): the first update`,
        at(2),
      );
      const secondUpdate = updateRecord(
        newRecordId(),
        storyId,
        `Journey test (${label}): the second update`,
        at(4),
      );

      // The run's own unlisted story and its two updates, through the console's calls.
      const made = await save(admin, '/api/v1/admin/social/stories', {
        record: story,
        listed: false,
      });
      expect(made.status).toBe(200);
      expect(made.body).toMatchObject({ id: storyId, listed: false, saved: 'new' });
      for (const update of [firstUpdate, secondUpdate]) {
        const saved = await save(admin, '/api/v1/admin/social/updates', { record: update });
        expect(saved.status).toBe(200);
        expect(saved.body).toEqual({ id: update.id, storyId, saved: 'new' });
      }

      // The lists: from the agreement, kept at the edge.
      const lists = await get(request, '/api/v1/social/lists');
      expect(lists.status).toBe(200);
      expect(lists.caching).toBe('public, max-age=0, must-revalidate');
      const parsedLists = social.lists.parse(lists.body);
      expect(parsedLists.categories.map((category) => category.code)).toContain('general');
      expect(parsedLists.places.map((place) => place.code)).toContain('mumbai');
      expect(parsedLists.sorts).toEqual(['top', 'latest']);

      // The board: every page parses, and the run's own (unlisted) story is on none of them, in either order.
      for (const sort of ['top', 'latest']) {
        let cursor = '';
        for (let page = 0; page < 8; page++) {
          const board = await get(request, `/api/v1/social/board?sort=${sort}&limit=100${cursor}`);
          expect(board.status, `${sort} page ${page}`).toBe(200);
          expect(board.caching).toBe('public, max-age=0, must-revalidate');
          const parsed = social.storyPage.parse(board.body);
          expect(
            parsed.stories.some((tile) => tile.id === storyId),
            `${sort}: the run's unlisted story is not on the board`,
          ).toBe(false);
          if (parsed.next === null) break;
          cursor = `&cursor=${encodeURIComponent(parsed.next)}`;
        }
      }
      const badCursor = await get(request, '/api/v1/social/board?cursor=not-a-cursor');
      expect(badCursor.status).toBe(400);
      expect(badCursor.body).toMatchObject({
        code: 'BAD_REQUEST',
        data: { issues: [{ path: 'cursor' }] },
      });

      // The story, with its updates newest first.
      const read = await get(request, `/api/v1/social/stories/${storyId}`);
      expect(read.status).toBe(200);
      expect(read.caching).toBe('public, max-age=0, must-revalidate');
      const detail = social.storyDetail.parse(read.body);
      if (detail.state !== 'live') throw new Error('The run’s story is live');
      expect(detail).toMatchObject({
        id: storyId,
        title: story.title,
        requestedId: null,
        listed: false,
        moreUpdates: false,
        categories: ['general'],
        places: ['mumbai'],
        counts: { posts: 0, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
      });
      expect(detail.updates.map((update) => update.id)).toEqual([secondUpdate.id, firstUpdate.id]);
      expect(detail.updates.map((update) => update.headline)).toEqual([
        secondUpdate.headline,
        firstUpdate.headline,
      ]);
      expect(detail.latestHeadline).toBe(secondUpdate.headline);

      // Its updates, one at a time, by the `next` of each page.
      const firstPage = await get(request, `/api/v1/social/stories/${storyId}/updates?limit=1`);
      expect(firstPage.status).toBe(200);
      const pageOne = social.updatePage.parse(firstPage.body);
      expect(pageOne.updates.map((update) => update.id)).toEqual([secondUpdate.id]);
      expect(pageOne.next).toEqual(expect.any(String));
      const secondPage = await get(
        request,
        `/api/v1/social/stories/${storyId}/updates?limit=1&cursor=${encodeURIComponent(pageOne.next ?? '')}`,
      );
      expect(secondPage.status).toBe(200);
      const pageTwo = social.updatePage.parse(secondPage.body);
      expect(pageTwo.updates.map((update) => update.id)).toEqual([firstUpdate.id]);
      expect(pageTwo.next).toBeNull();
      const wrongCursor = await get(
        request,
        `/api/v1/social/stories/${storyId}/updates?cursor=not-a-cursor`,
      );
      expect(wrongCursor.status).toBe(400);

      // Its desk: no agent has posted on the run's own story.
      const desk = await get(request, `/api/v1/social/stories/${storyId}/posts`);
      expect(desk.status).toBe(200);
      expect(social.postPage.parse(desk.body)).toEqual({ posts: [], next: null });

      // Its brief: the title and both updates, and one version for one file.
      const brief = await get(request, `/api/v1/social/stories/${storyId}/brief`);
      expect(brief.status).toBe(200);
      expect(brief.caching).toBe('public, max-age=0, must-revalidate');
      const written = social.brief.parse(brief.body);
      expect(written.storyId).toBe(storyId);
      expect(written.markdown).toContain(story.title);
      expect(written.markdown).toContain(firstUpdate.headline);
      expect(written.markdown).toContain(secondUpdate.headline);
      const again = social.brief.parse(
        (await get(request, `/api/v1/social/stories/${storyId}/brief`)).body,
      );
      expect(again.version).toBe(written.version);

      // An ID no story has is 404 on every read, and an address that is no ID is refused.
      const unknown = newRecordId();
      for (const path of ['', '/updates', '/posts', '/brief']) {
        const missing = await get(request, `/api/v1/social/stories/${unknown}${path}`);
        expect(missing.status, `stories/<unknown>${path}`).toBe(404);
        expect(missing.body).toMatchObject({ code: 'NOT_FOUND', message: 'No such story' });
        expect(missing.caching).toBe('private, no-store');
      }
      expect((await get(request, '/api/v1/social/stories/not-an-id')).status).toBe(400);

      // The purge, end to end. First each of three reads the save changes (the story, its first page of
      // updates and its brief) is read until the edge serves a copy (where there is an edge), and how old
      // that copy was, and when, is noted for each: the save must show on each before its copy's own
      // minute is up, so the edge's expiry can never explain a pass.
      const storyPath = `/api/v1/social/stories/${storyId}`;
      const updatesPath = `${storyPath}/updates?limit=1`;
      const briefPath = `${storyPath}/brief`;
      const [primedStory, primedUpdates, primedBrief] = await Promise.all([
        prime(request, storyPath),
        prime(request, updatesPath),
        prime(request, briefPath),
      ]);
      test.info().annotations.push({
        type: 'edge',
        description: onVercel()
          ? `Served from Vercel's edge before the save: the story a copy ${primedStory.age} s old, its updates ${primedUpdates.age} s, its brief ${primedBrief.age} s.`
          : 'No edge here: nothing was kept before the save.',
      });

      // A third update, through the console: the save answers, then purges the story's tags and brief.
      const thirdUpdate = updateRecord(
        newRecordId(),
        storyId,
        `Journey test (${label}): the third update`,
        at(6),
      );
      const third = await save(admin, '/api/v1/admin/social/updates', { record: thirdUpdate });
      expect(third.status).toBe(200);
      expect(third.body).toEqual({ id: thirdUpdate.id, storyId, saved: 'new' });
      const savedAt = Date.now();
      const deadline = savedAt + PURGE_DEADLINE_MS;
      /** The copy the edge kept would still have been fresh when the new answer showed: so a purge did it. */
      const beforeItsOwnExpiry = (
        what: string,
        primed: { age: number; at: number },
        shownAt: number,
      ) => {
        if (onVercel()) {
          expect(
            primed.age + (shownAt - primed.at) / 1000,
            `${what} showed the save before the old copy's own minute was up, so the purge did it`,
          ).toBeLessThan(EDGE_SECONDS);
        }
      };

      // The story read shows it within seconds, not at the end of the edge's own minute.
      const story3 = await until(
        deadline,
        async () => {
          const now = await get(request, storyPath);
          expect(now.status).toBe(200);
          const parsed = social.storyDetail.parse(now.body);
          return parsed.state === 'live' ? parsed.updates.map((update) => update.id) : [];
        },
        (shown) => shown[0] === thirdUpdate.id,
      );
      expect(
        story3.answer,
        `the story shows the third update within ${PURGE_DEADLINE_MS / 1000} seconds of the save`,
      ).toEqual([thirdUpdate.id, secondUpdate.id, firstUpdate.id]);
      beforeItsOwnExpiry('the story read', primedStory, story3.at);

      // The first page of updates (the address read and kept above) is tagged with the story too.
      const updates3 = await until(
        deadline,
        async () => {
          const now = await get(request, updatesPath);
          expect(now.status).toBe(200);
          return social.updatePage.parse(now.body).updates.map((update) => update.id);
        },
        (shown) => shown[0] === thirdUpdate.id,
      );
      expect(updates3.answer, 'the first page of updates shows the third update').toEqual([
        thirdUpdate.id,
      ]);
      beforeItsOwnExpiry('the updates read', primedUpdates, updates3.at);

      // The brief: its Redis copy is deleted by the save before the tags are purged, so the refresh the
      // edge makes can't read the old file, and it shows the update before its own edge copy expired.
      const brief3 = await until(
        deadline,
        async () => {
          const now = await get(request, briefPath);
          expect(now.status).toBe(200);
          return social.brief.parse(now.body);
        },
        (file) => file.markdown.includes(thirdUpdate.headline),
      );
      expect(brief3.answer.markdown, "the brief holds the third update's headline").toContain(
        thirdUpdate.headline,
      );
      expect(brief3.answer.version, 'the brief is a new file').not.toBe(written.version);
      beforeItsOwnExpiry('the brief read', primedBrief, brief3.at);
      test.info().annotations.push({
        type: 'purge',
        description: `After the save, the story showed it ${((story3.at - savedAt) / 1000).toFixed(1)} s later, its updates ${((updates3.at - savedAt) / 1000).toFixed(1)} s, its brief ${((brief3.at - savedAt) / 1000).toFixed(1)} s.`,
      });

      // The same six reads are MCP tools, in beta and public: an AI tool with no key lists them, and
      // the story tool answers the story as the API does (the answer is a choice of two shapes).
      const client = new Client({ name: `hrizzup-journey-${browserName}`, version: '1.0.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${baseURL ?? ''}/api/v1/mcp`), {
          fetch: fetchThrough(anyone),
        }),
      );
      const listed = (await client.listTools()).tools;
      for (const name of [
        'social_lists',
        'social_board',
        'social_stories_get',
        'social_stories_updates',
        'social_stories_posts',
        'social_stories_brief',
      ]) {
        const tool = listed.find((one) => one.name === name);
        expect(tool, `${name} is a tool with no key`).toBeTruthy();
        expect(tool?.description ?? '', name).toMatch(/^\(beta\) /);
        expect(tool?.annotations, name).toMatchObject({ readOnlyHint: true });
      }
      const viaTool = await client.callTool({
        name: 'social_stories_get',
        arguments: { id: storyId },
      });
      expect(viaTool.isError, JSON.stringify(viaTool.content)).toBeFalsy();
      const viaApi = social.storyDetail.parse(
        (await get(request, `/api/v1/social/stories/${storyId}`)).body,
      );
      expect(social.storyDetail.parse(viaTool.structuredContent)).toEqual(viaApi);
      const noStory = await client.callTool({
        name: 'social_stories_get',
        arguments: { id: newRecordId() },
      });
      expect(noStory.isError).toBe(true);
      expect(JSON.stringify(noStory.content)).toContain('No such story');
    } finally {
      await Promise.all(clients.map((one) => one.close().catch(() => undefined)));
      await Promise.all([admin.dispose(), anyone.dispose()]);
    }
  });
});
