import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_STORY_IDS } from '../../../lib/social/fixture-ids.ts';
import {
  BOARD_FIXTURE_STORY,
  BOARD_FIXTURE_UPDATES,
  BOARD_MERGED_STORY,
  BOARD_WITHDRAWN_REASON,
  BOARD_WITHDRAWN_STORY,
  boardFixtures,
} from './board.ts';

/**
 * The board's fixture stories (R5's M5): a live one with three updates, a withdrawn one and one merged into the
 * live one, each found by its public read, made through the console's saves only where something is missing,
 * never writing what is there, never taking one that is not as it was made, and a failure names a status, never
 * an answer.
 */

const context = { baseURL: 'https://preview.example.test', headers: { cookie: 'a=b' } };
const [fixture, withdrawn, merged] = boardFixtures;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What the public read answers for the live fixture, as it was made: live, unlisted, its own address. */
const LIVE = { state: 'live', listed: false, requestedId: null };

type Sent = { method: string; path: string; body: { record?: Record<string, unknown> } | null };

/** A stand-in for `fetch`: answers the read and each save as given, and remembers what was sent. */
function site(answers: { read: [number, unknown]; save?: [number, unknown] }) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL, init: { method: string; body?: string }) => {
      sent.push({
        method: init.method,
        path: input.pathname,
        body: init.body ? JSON.parse(init.body) : null,
      });
      const [status, body] = init.method === 'GET' ? answers.read : (answers.save ?? [200, {}]);
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe('the board’s fixture story', () => {
  it('has a version 7 ID of its own, three live updates in time order, the last one correcting the first', () => {
    expect(BOARD_FIXTURE_STORY).toMatch(RECORD_ID);
    expect(BOARD_FIXTURE_STORY.startsWith('019a6c00-')).toBe(false);
    const ids = BOARD_FIXTURE_UPDATES.map((update) => update.id);
    expect(new Set([BOARD_FIXTURE_STORY, ...ids]).size).toBe(4);
    for (const id of ids) expect(id).toMatch(RECORD_ID);
    const times = BOARD_FIXTURE_UPDATES.map((update) => Date.parse(update.reportedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(BOARD_FIXTURE_UPDATES).toHaveLength(3);
    expect(BOARD_FIXTURE_UPDATES[2]).toMatchObject({ corrects: ids[0] });
  });

  it('makes the story unlisted, then its updates oldest first, when it is not there', async () => {
    const sent = site({ read: [404, { message: 'No such story' }] });
    await fixture?.ensure(context);
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual([
      `GET /api/v1/social/stories/${BOARD_FIXTURE_STORY}`,
      'POST /api/v1/admin/social/stories',
      'POST /api/v1/admin/social/updates',
      'POST /api/v1/admin/social/updates',
      'POST /api/v1/admin/social/updates',
    ]);
    expect(sent[1]?.body).toMatchObject({ listed: false, record: { id: BOARD_FIXTURE_STORY } });
    expect(sent.slice(2).map((one) => one.body?.record?.id)).toEqual(
      BOARD_FIXTURE_UPDATES.map((update) => update.id),
    );
    expect(sent[4]?.body?.record).toMatchObject({ corrects: BOARD_FIXTURE_UPDATES[0].id });
    // Every record carries fixed times in the past, so a second make sends the very same records.
    for (const one of sent.slice(1)) {
      expect(Date.parse(String(one.body?.record?.updated_at)), one.path).toBeLessThan(Date.now());
    }
    const again = site({ read: [404, {}] });
    await fixture?.ensure(context);
    expect(JSON.stringify(again)).toBe(JSON.stringify(sent));
  });

  it('writes nothing when the story and its three updates are there', async () => {
    const sent = site({
      read: [
        200,
        {
          ...LIVE,
          updates: BOARD_FIXTURE_UPDATES.map((update) => ({ id: update.id })),
        },
      ],
    });
    await fixture?.ensure(context);
    expect(sent).toHaveLength(1);
  });

  it('makes only the updates that are missing, and not the story', async () => {
    const sent = site({
      read: [200, { ...LIVE, updates: [{ id: BOARD_FIXTURE_UPDATES[0].id }] }],
    });
    await fixture?.ensure(context);
    expect(sent.slice(1).map((one) => `${one.method} ${one.path}`)).toEqual([
      'POST /api/v1/admin/social/updates',
      'POST /api/v1/admin/social/updates',
    ]);
    expect(sent.slice(1).map((one) => one.body?.record?.id)).toEqual([
      BOARD_FIXTURE_UPDATES[1].id,
      BOARD_FIXTURE_UPDATES[2].id,
    ]);
  });

  it('takes a story an update has since moved on (409 stale_record) as already there', async () => {
    site({
      read: [404, {}],
      save: [409, { data: { reason: 'stale_record' } }],
    });
    await expect(fixture?.ensure(context)).resolves.toBeUndefined();
  });

  it('fails on any other answer, naming the status and never what was answered', async () => {
    site({ read: [404, {}], save: [403, { secret: 'a value that must never be printed' }] });
    await expect(fixture?.ensure(context)).rejects.toThrow(
      "Couldn't make the board's fixture story (403)",
    );
    const unreadable = site({ read: [500, { secret: 'a value that must never be printed' }] });
    const failure = await fixture?.ensure(context).catch((error: Error) => error);
    expect((failure as Error).message).toBe("Couldn't read the board's fixture story (500)");
    expect(unreadable).toHaveLength(1);
    site({ read: [404, {}], save: [409, { data: { reason: 'listing_fixed' } }] });
    await expect(fixture?.ensure(context)).rejects.toThrow('(409)');
  });
});

describe('the board’s fixture story, when it is there but is not as it was made', () => {
  it('fails on a withdrawn, a listed or a merged-address answer, naming the status only, and writes nothing', async () => {
    for (const answer of [
      { state: 'withdrawn', withdrawnReason: 'a reason that must never be printed' },
      { ...LIVE, listed: true, updates: [] },
      { ...LIVE, requestedId: BOARD_MERGED_STORY, updates: [] },
      { ...LIVE, state: 'merged', updates: [] },
    ]) {
      const sent = site({ read: [200, answer] });
      const failure = await fixture?.ensure(context).catch((error: Error) => error);
      expect((failure as Error).message).toBe(
        "The board's fixture story isn't as it was made (200)",
      );
      expect(sent).toHaveLength(1);
    }
  });
});

describe('the board’s withdrawn fixture story', () => {
  it('has an ID of its own and a reason its page gives', () => {
    expect(BOARD_WITHDRAWN_STORY).toMatch(RECORD_ID);
    expect(BOARD_MERGED_STORY).toMatch(RECORD_ID);
    expect(new Set([BOARD_FIXTURE_STORY, BOARD_WITHDRAWN_STORY, BOARD_MERGED_STORY]).size).toBe(3);
    expect(BOARD_WITHDRAWN_REASON.length).toBeGreaterThan(0);
    expect(boardFixtures).toHaveLength(3);
  });

  it('makes it live, unlisted, and then saves it again withdrawn with the reason, when it is not there', async () => {
    const sent = site({ read: [404, {}] });
    await withdrawn?.ensure(context);
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual([
      `GET /api/v1/social/stories/${BOARD_WITHDRAWN_STORY}`,
      'POST /api/v1/admin/social/stories',
      'POST /api/v1/admin/social/stories',
    ]);
    expect(sent[1]?.body).toMatchObject({
      listed: false,
      record: { id: BOARD_WITHDRAWN_STORY, state: 'live' },
    });
    expect(sent[2]?.body).toMatchObject({
      listed: false,
      record: {
        id: BOARD_WITHDRAWN_STORY,
        state: 'withdrawn',
        withdrawn_reason: BOARD_WITHDRAWN_REASON,
      },
    });
    // Changed after it was made, and both in the past: a second make sends the very same records.
    const [made, changed] = [sent[1], sent[2]].map((one) => one?.body?.record);
    expect(Date.parse(String(changed?.updated_at))).toBeGreaterThan(
      Date.parse(String(made?.updated_at)),
    );
    expect(Date.parse(String(changed?.updated_at))).toBeLessThan(Date.now());
    const again = site({ read: [404, {}] });
    await withdrawn?.ensure(context);
    expect(JSON.stringify(again)).toBe(JSON.stringify(sent));
  });

  it('writes nothing when it is withdrawn with its reason, and only the withdrawal when it was made live', async () => {
    const there = site({
      read: [200, { state: 'withdrawn', withdrawnReason: BOARD_WITHDRAWN_REASON }],
    });
    await withdrawn?.ensure(context);
    expect(there).toHaveLength(1);
    const half = site({ read: [200, { ...LIVE }] });
    await withdrawn?.ensure(context);
    expect(half.map((one) => one.method)).toEqual(['GET', 'POST']);
    expect(half[1]?.body?.record).toMatchObject({ state: 'withdrawn' });
  });

  it('fails when what is there is not what it was made as, naming the status only', async () => {
    for (const answer of [
      { state: 'withdrawn', withdrawnReason: 'another reason, never printed' },
      { ...LIVE, listed: true },
      { ...LIVE, state: 'merged' },
    ]) {
      const sent = site({ read: [200, answer] });
      const failure = await withdrawn?.ensure(context).catch((error: Error) => error);
      expect((failure as Error).message).toBe(
        "The board's withdrawn story isn't as it was made (200)",
      );
      expect(sent).toHaveLength(1);
    }
    site({ read: [404, {}], save: [403, { secret: 'never printed' }] });
    await expect(withdrawn?.ensure(context)).rejects.toThrow(
      "Couldn't make the board's withdrawn story (403)",
    );
    site({ read: [500, {}] });
    await expect(withdrawn?.ensure(context)).rejects.toThrow(
      "Couldn't read the board's withdrawn story (500)",
    );
  });
});

describe('the board’s merged fixture story', () => {
  it('makes it live, unlisted, and then saves it again merged into the live fixture, when it is not there', async () => {
    const sent = site({ read: [404, {}] });
    await merged?.ensure(context);
    expect(sent.map((one) => `${one.method} ${one.path}`)).toEqual([
      `GET /api/v1/social/stories/${BOARD_MERGED_STORY}`,
      'POST /api/v1/admin/social/stories',
      'POST /api/v1/admin/social/stories',
    ]);
    expect(sent[1]?.body).toMatchObject({
      listed: false,
      record: { id: BOARD_MERGED_STORY, state: 'live' },
    });
    expect(sent[1]?.body?.record).not.toHaveProperty('merged_into');
    expect(sent[2]?.body).toMatchObject({
      listed: false,
      record: { id: BOARD_MERGED_STORY, state: 'merged', merged_into: BOARD_FIXTURE_STORY },
    });
    // It has no updates to move: a console save can't move a story's updates with the merge.
    expect(sent.every((one) => !one.path.endsWith('/updates'))).toBe(true);
  });

  it('writes nothing when its address answers the live fixture with its own address asked for', async () => {
    const there = site({
      read: [200, { ...LIVE, id: BOARD_FIXTURE_STORY, requestedId: BOARD_MERGED_STORY }],
    });
    await merged?.ensure(context);
    expect(there).toHaveLength(1);
    const half = site({ read: [200, { ...LIVE, id: BOARD_MERGED_STORY }] });
    await merged?.ensure(context);
    expect(half.map((one) => one.method)).toEqual(['GET', 'POST']);
    expect(half[1]?.body?.record).toMatchObject({ state: 'merged' });
  });

  it('fails when it went somewhere else or was listed, naming the status only', async () => {
    for (const answer of [
      { ...LIVE, id: BOARD_WITHDRAWN_STORY, requestedId: BOARD_MERGED_STORY },
      { ...LIVE, id: BOARD_MERGED_STORY, listed: true },
      { state: 'withdrawn', id: BOARD_MERGED_STORY, requestedId: null },
    ]) {
      const sent = site({ read: [200, answer] });
      const failure = await merged?.ensure(context).catch((error: Error) => error);
      expect((failure as Error).message).toBe(
        "The board's merged story isn't as it was made (200)",
      );
      expect(sent).toHaveLength(1);
    }
  });
});

describe('the stories the console keeps its hands off', () => {
  it('are exactly the stories the fixtures make: every story record the three save has an ID in the console’s list of kept stories, and every one of them is made', async () => {
    const made = new Set<string>();
    for (const one of boardFixtures) {
      const sent = site({ read: [404, {}] });
      await one.ensure(context);
      for (const request of sent) {
        const id = request.body?.record?.id;
        if (request.path.endsWith('/stories') && typeof id === 'string') made.add(id);
      }
    }
    expect(made).toEqual(KEPT_STORY_IDS);
  });
});
