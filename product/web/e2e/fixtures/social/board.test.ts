import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_FIXTURE_STORY, BOARD_FIXTURE_UPDATES, boardFixtures } from './board.ts';

/**
 * The board's fixture story (R5's M5): found by its public read, made through the console's saves only
 * where something is missing, never writing what is there, and a failure names a status, never an answer.
 */

const context = { baseURL: 'https://preview.example.test', headers: { cookie: 'a=b' } };
const [fixture] = boardFixtures;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
        { state: 'live', updates: BOARD_FIXTURE_UPDATES.map((update) => ({ id: update.id })) },
      ],
    });
    await fixture?.ensure(context);
    expect(sent).toHaveLength(1);
  });

  it('makes only the updates that are missing, and not the story', async () => {
    const sent = site({
      read: [200, { state: 'live', updates: [{ id: BOARD_FIXTURE_UPDATES[0].id }] }],
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
